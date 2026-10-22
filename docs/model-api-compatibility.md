# 模型接口维护记录

GLM 接入核对日期：2026-10-22；其他服务核对日期：2026-10-10。适用范围：设置页、工作台、聊天室、角色辅助修改、LaTeX 辅助和实验流程树共享的六个服务适配器。

| 服务 | 新版内置模型 |
| --- | --- |
| DeepSeek | deepseek-flash（界面显示 DeepSeek V4.1 Flash） |
| OpenAI | gpt-6.1-sol、gpt-6-astra、gpt-6-luna；保留 GPT 5.6 三档 |
| Claude | claude-opus-5-5、claude-sonnet-5-5、claude-haiku-4-5；保留 Opus/Sonnet 4.6 |
| Gemini | gemini-3.8-flash、gemini-3.5-flash-lite、gemini-3.1-pro-preview、gemini-3.5-flash |
| 智谱 GLM | glm-5.3、glm-5.3-flash |
| 千问 | qwen3.8-max、qwen3.7-plus、qwen3.8-flash、qwen3.7-flash |

模型列表是可维护的内置目录，不是账户实时权限列表。Gemini Pro 当前入口为预览模型。DeepSeek V4.1 Flash 的官方 API ID 是 `deepseek-flash`；旧内置型号和误用的展示名称会自动迁移到该 ID。其他服务保存的模型、自定义模型和角色专用模型继续保留。

## 调用兼容性

- OpenAI 的 GPT 5/6 与 o 系列推理模型使用 max_completion_tokens，不发送默认推理模式不支持的 temperature。旧款普通模型仍保留温度设置。本项目当前使用纯文本 Chat Completions；后续增加工具调用时应另行接入 Responses。
- Claude 新模型移除不支持的 temperature；Haiku 4.5 和旧款 Sonnet/Opus 4.6 保留。回复只读取 text 类型内容块。
- Claude 与 Gemini 合并所有系统指令，避免只取第一条而丢失角色协议。
- Gemini 的最终回复不混入 thought 内容；聊天室的非流式调用改用 generateContent，普通讨论继续使用 streamGenerateContent。
- 移除 Gemini 内置目录中的错误 Pro 名称和视频生成型号，避免把非聊天能力当作文字模型。
- DeepSeek 与千问保留各自 OpenAI 兼容端点、认证方式和正文结构；DeepSeek 讨论中的思考开关继续按请求传入。
- 模型选择器显示角色自身保存的快照或自定义型号，避免重新渲染时被替换成首个内置模型。

## 验证范围

回归测试覆盖六种服务流式格式、非流式 Gemini、请求参数、系统指令、最终文本过滤与模型选择保留。不使用真实密钥，不代表每个账户均拥有这些模型的调用权限。设置页的“测试连接”可针对用户选择的模型进行实际验证。

## 官方依据

- [DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
- [OpenAI 最新模型与迁移](https://developers.openai.com/api/docs/guides/latest-model)
- [Claude 模型目录](https://platform.claude.com/docs/en/models/overview)、[Opus 5.5 迁移](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide)、[Sonnet 5.5 迁移](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)
- [Gemini 模型目录](https://ai.google.dev/gemini-api/docs/models)
- [千问文本模型目录](https://help.aliyun.com/zh/model-studio/text-generation-model)、[OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)

## GLM 参数

使用 `https://open.bigmodel.cn/api/paas/v4/chat/completions` 与 Bearer 认证，复用 OpenAI SSE 解析。GLM 5.3 系列传入 `thinking.type: enabled` 和 `reasoning_effort`（优先使用角色/对比条目的独立选择，普通页面优先使用本页选择，否则沿用全局）（low / high / max，默认 max）。自定义的其他型号不自动附带这些参数。标准端点不启用保留式思考；现有页面只提交文本历史。连接测试为 GLM 预留 4096 token，避免原有 256 token 过早耗尽推理预算。

[智谱对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)、[GLM-5.3-Flash](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)。
