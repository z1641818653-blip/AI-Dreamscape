# 下载与二次采集服务

GitHub Pages 只能提供静态文件，不能运行采集服务。页面在启动时检测同域的 `api/research/health`：连接成功后，来源请求、公开页面文件发现及下载由采集服务处理；静态部署仍保留原有直连和直接打开入口。

## 本机启动

需要 Node.js 22 或更新版本。执行：

```sh
npm ci
npm start
```

打开 `http://127.0.0.1:8787/research.html`。默认仅监听本机；不需要模型 API Key 即可关闭模型开关，执行真实资料检索、文件发现和下载。

## 部署

服务和页面需使用同一域名。可以直接使用 Node.js 服务或仓库的 Dockerfile：

- 启动命令：`npm start`
- `HOST=0.0.0.0`
- `PORT=8787`，或使用平台分配端口
- `SITE_ORIGIN=https://你的实际域名`，不能包含路径或结尾斜杠
- 反向代理需保留该域名的 Host，并转发 `/api/research/*` 与页面请求到同一个服务

Docker 示例：

```sh
docker build -t dreamscape .
docker run --rm -p 8787:8787 -e SITE_ORIGIN=https://你的实际域名 dreamscape
```

Docker 服务也可在本机通过 `http://127.0.0.1:8787` 访问；本机测试时省略 `SITE_ORIGIN`。新的域名不会自动迁移原 GitHub Pages 域名下的本机清单和模型配置，使用原有备份导出/恢复即可迁移清单，密钥需重新配置。

## 获取流程

1. 优先尝试已有直链。来源直链不可用时，进入二次采集。
2. Internet Archive 读取文件清单，优先选择 64 MB 内的兼容资源；Zenodo 读取记录的公开附件列表。
3. Europe PMC 通过 DOI 或来源标识查询开放文件；PDF 受限时尝试官方开放全文 XML。XML 是全文文件，页面会显示其实际格式。
4. 通用公开页面读取 Citation Meta、JSON-LD、附件链接及 video/audio/source 元素。只读取静态 HTML，不运行页面脚本，不递归抓取整站。
5. 对候选文件进行最多 8 KB 的轻量 GET 验证，拒绝返回 HTML 的文件地址，检查 PDF 文件签名，并保留实际类型、来源和失败原因。
6. 服务校验文件开头后持续传输，浏览器显示接收进度，支持单项保存与 ZIP 合集。失效直链可查找备用文件。

采集范围为无需登录的公开文件。需要登录、访问受限、未发现文件、连接超时及超过大小限制会明确显示；不会将超时误报为“来源没有文件”。动态播放器、加密媒体及分片媒体合并未包含在本次实现中。

## 限制与访问控制

- 仅 HTTPS 公网请求；拒绝 URL 凭据、非标准端口和私网地址。
- 校验全部 DNS 结果并固定连接 IP；每次跳转重新校验，最多四次。
- 不转发浏览器 Cookie、模型密钥、Authorization 或用户自定义请求头。
- API 仅允许同域 JSON POST 和指定客户端请求头，不启用跨域代理访问。
- 默认最多四个采集任务并发；请求体 32 KB，页面/API 响应 4 MB，单文件和 ZIP 64 MB。
- 文件流中断或超限时结束传输，浏览器不会把不完整内容当作下载成功。
- 服务只提供页面及资产，不提供源码目录、测试、依赖目录或配置文件。

## 验证

```sh
npm test
npm run test:live
```

`npm test` 包含服务检查和全站浏览器回归，使用固定测试数据。`npm run test:live` 使用真实公网接口，没有请求模拟，也不需要模型凭据；验证 Europe PMC 的浏览器内检索、二次采集、全文保存，以及 Zenodo 的完整 PDF 下载，并单独记录 Internet Archive 的连接结果。输出位于 `test-results/research-live.json` 与 `research-live.png`，包含字节数和文件 SHA-256。网络不可达的来源单独记录，不能据此声称该来源实测通过。

官方接口：[Europe PMC](https://europepmc.org/RestfulWebService)、[Zenodo](https://developers.zenodo.org/)、[Internet Archive](https://archive.org/developers/)。
