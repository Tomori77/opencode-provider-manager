# opencode-provider-manager

为 [opencode](https://opencode.ai) 提供的本地小工具：输入 API 地址和 Key 拉取模型列表，勾选后一键写入 opencode 的提供商配置，并支持编辑与备份恢复。

零第三方依赖，仅需 Node.js 18+。

**界面分为四个页签：**

- **拉取模型** — 输入 API 地址和 Key，拉取模型、勾选后一键添加；也可测试连通性/校验 Key。
- **已有配置** — 列出本机所有提供商，可重新拉取编辑、启用/禁用、删除。
- **备份** — 手动「立即备份」，备份列表分页显示，可恢复或删除。
- **设置** — 开关自动备份、设置备份每页条数，查看配置文件/备份目录/设置文件路径。

## 功能

1. **拉取模型** — 输入 `baseURL` 和 `API Key`，调用兼容 OpenAI 的 `/models` 接口获取模型列表。
2. **一键添加** — 从列表中勾选模型，一键合并写入 opencode 配置。
3. **改配置** — 直接修改本机 `~/.config/opencode/opencode.jsonc`。
4. **重新拉取 / 编辑** — 对已有提供商点「重新拉取」，自动回填该提供商的地址、Key、请求头，重新拉取模型并预选现有模型，修改后「保存修改」写回；可勾选「完全替换模型列表」让删除的模型真正生效。若表单里已手动输入了 API Key，重新拉取时不会静默覆盖，会询问是保留你的输入还是改用已保存的 Key。
5. **备份** — 自动备份可开关（默认开）；也可随时手动备份；备份列表分页展示，支持一键恢复和删除。

## 使用

需要 Node.js 18+（推荐 20+）。

方式一：双击 `start.bat`（Windows，会自动打开浏览器）。

方式二：命令行

```bash
cd opencode-provider-tool
node server.js
```

然后浏览器打开 http://127.0.0.1:3456

## 说明

- 默认配置文件：`C:\Users\<你>\.config\opencode\opencode.jsonc`（不存在会自动创建；若只有 `opencode.json` 则写入该文件）。
- 备份目录：`~/.config/opencode/backups/`，文件名形如 `opencode.jsonc.<时间>.bak`。
- provider 默认使用 npm 包 `@ai-sdk/openai-compatible`，`apiKey` 写入 `options.apiKey`。
- 认证默认为 `Authorization: Bearer <key>`，可在「高级选项」里改为自定义请求头。
- 会保留配置中其它字段（`$schema`、`shell`、`plugin` 等），只增改 `provider` 与 `disabled_providers`。
- 写入时会先解析 JSONC（支持注释、尾随逗号），写回为标准 JSON（JSON 是 JSONC 的子集）。若原文件含注释，写回后注释不会保留（原文件在备份里）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3456` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 当前配置、提供商列表、设置 |
| GET | `/api/settings` | 读取设置 |
| POST | `/api/settings` | 保存设置 `{ autoBackup, backupPageSize }` |
| GET | `/api/backups?page=&pageSize=` | 分页备份列表 |
| POST | `/api/backup` | 立即手动备份 |
| POST | `/api/backup/delete` | 删除备份 `{ file }` |
| POST | `/api/models` | 拉取模型 `{ baseURL, apiKey, headerName?, headerValue?, extraHeaders? }` |
| POST | `/api/test` | 测试连通性/校验 Key `{ baseURL, apiKey, headerName?, headerValue?, extraHeaders?, model? }` |
| POST | `/api/provider` | 添加/合并提供商 |
| POST | `/api/provider/detail` | 获取单个提供商详情（含 apiKey、headers）`{ id }` |
| POST | `/api/provider/delete` | 删除提供商 `{ id }` |
| POST | `/api/provider/enabled` | 启用/禁用 `{ id, enabled }` |
| POST | `/api/restore` | 恢复备份 `{ file }` |
