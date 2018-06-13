import crypto from 'crypto';
import path from 'path';
import postcss from 'postcss';
import request from 'request-promise';

import generatorFilename from './generator-filename';

const urlReg = /url\(('|")?((?:http|\/\/)(?:[^\"\']+))(\1)\)/;

const getDeclUrl = (value) => {
  const url = value.match(urlReg)[2];
  const md5 = crypto.createHash('md5');
  const urlIdentity = md5.update(url).digest('hex');

  return { urlIdentity, url };
};

export default postcss.plugin(
  'postcss-assets',
  ({ outputOptions, options }, opts = {}) => {
    // 所有 css 中的网络请求
    const networkRequestMap = {};
    return (root) => {
      return new Promise((resolve) => {
        // 字体文件
        root.walkAtRules((atrule) => {
          atrule.walkDecls((decl) => {
            if (decl.prop == 'src') {
              decl.value.split(',').forEach((value) => {
                if (urlReg.test(value)) {
                  const { url, urlIdentity } = getDeclUrl(value);
                  networkRequestMap[urlIdentity] = { url, decl };
                }
              });
            }
          });
        });
        // 常规 css
        root.walkRules((rule) => {
          rule.walkDecls((decl) => {
            if (decl.prop == 'background-image' || decl.prop == 'background') {
              if (urlReg.test(decl.value)) {
                const { url, urlIdentity } = getDeclUrl(decl.value);
                networkRequestMap[urlIdentity] = { url, decl };
              }
            }
          });
        });

        if (Object.keys(networkRequestMap).length > 0) {
          Promise.all(
            Object.entries(networkRequestMap).map(([key, networkRequest]) => {
              const originUrl = networkRequest.url;
              const url = originUrl.startsWith('http')
                ? originUrl
                : `http:${originUrl}`;
              return request.get({ url, encoding: null }).then((res) => {
                const buffer = Buffer.from(res, 'utf-8');
                const ext = path.extname(url);
                const md5 = crypto.createHash('md5');
                const basename = md5.update(buffer).digest('hex') + ext;
                const outputPath = path.join(
                  outputOptions.publicPath,
                  options.outputPath,
                  basename
                );

                const asset = {
                  contents: buffer,
                  path: outputPath,
                  basename,
                };

                networkRequestMap[key] = asset;

                opts.emit(asset);
                return Promise.resolve(asset);
              });
            })
          ).then(() => {
            // 字体文件
            root.walkAtRules((atrule) => {
              atrule.walkDecls((decl) => {
                if (decl.prop == 'src') {
                  const newValue = decl.value
                    .split(',')
                    .map((value) => {
                      if (urlReg.test(value)) {
                        const { urlIdentity } = getDeclUrl(value);
                        return value.replace(urlReg, () => {
                          return `url('${
                            networkRequestMap[urlIdentity].path
                          }')`;
                        });
                      }
                    })
                    .join(',');
                  decl.value = newValue;
                }
              });
            });
            // 常规 css
            root.walkRules((rule) => {
              rule.walkDecls((decl) => {
                if (
                  decl.prop == 'background-image' ||
                  decl.prop == 'background'
                ) {
                  if (urlReg.test(decl.value)) {
                    const { urlIdentity } = getDeclUrl(decl.value);
                    decl.value = decl.value.replace(urlReg, () => {
                      return `url('${networkRequestMap[urlIdentity].path}')`;
                    });
                  }
                }
              });
            });
            resolve();
          });
        } else {
          resolve();
        }
      });
    };
  }
);
