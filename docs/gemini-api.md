# Gemini API 接入

核对日期：2026-11-19。

在全局配置展开 Gemini，填入 Google AI Studio API Key，选择默认模型与推理强度，保存后各页面共用。连接测试使用当前尚未保存的字段，仅点击时才发送一次请求。

内置模型：Gemini 4 Hydrogen、Neon、Carbon、Argon，Gemini 3.8 Flash、3.5 Flash-Lite、3.1 Pro Preview。已有自定义模型保留。强度按模型动态生成：Hydrogen / Neon 支持 low / medium / high / xhigh，Carbon / Argon / 3.8 Flash 支持 low / medium / high；留空使用模型默认。Gemini 4 不发送采样参数，输出额度包含思考，避免用过小额度导致空正文。

沿用仍受 Google 支持的 GenerateContent REST API，聊天使用 streamGenerateContent，连接测试、工作流、翻译等使用 generateContent。认证使用 x-goog-api-key 请求头，不把 Key 放入 URL。无需新增服务器或 SDK；浏览器网络仍须能访问 Google 官方服务。

资料检索选择 Gemini 后，使用全局默认 Gemini 模型，方向拆解和翻译使用结构化 JSON 输出；Agent 使用原生函数调用，保存并原样回传模型 parts / thoughtSignature，恢复进度后不丢签名。网页搜索和正文读取仍使用现有 DeepSeek Search / Fetch，因此这两个工具仍需 DeepSeek Key；论文元数据和 Commons 图片公共检索不需要 DeepSeek Key。Key 沿用现有本机配置存储，不进入任务记录。

Google 当前推荐新项目使用 Interactions API；本次保持灵境既有 GenerateContent 架构，后者仍受支持，避免引入服务器会话存储。

本地验证：19 项核心测试、102 项原有浏览器检查、Gemini 配置专项浏览器检查。新增测试使用模拟响应和假 Key，未对用户真实密钥或账户额度发起请求，真实可用性需在全局配置中点击连接测试。

官方资料：
- https://aistudio.google.com/docs/models
- https://aistudio.google.com/docs/thinking
- https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen
- https://aistudio.google.com/docs/thought-signatures?generate-content=true
