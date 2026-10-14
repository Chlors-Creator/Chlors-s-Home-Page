# Cloudflare Pages 发布配置

## 密钥与环境变量

以下三项只放在 Cloudflare Secrets/Environment Variables，不写入源码、日志或 `config.json`：

- `GITHUB_TOKEN`：Fine-grained token，仅授予目标仓库 `Contents: Read and write`
- `ADMIN_PASSWORD`：文章发布页管理员密码
- `STATUS_REPORT_TOKEN`：状态上报专用随机 Token

Pages 项目可在 **Settings → Environment variables** 的 **Production** 环境录入，也可以在项目根目录用 Wrangler 逐项输入。先查询实际项目名；`YOUR_PAGES_PROJECT_NAME` 不能原样输入：

```powershell
npx wrangler pages project list
$pagesProject = '把这里替换为列表中实际的 Pages 项目名'
npx wrangler pages secret put GITHUB_TOKEN --project-name $pagesProject
npx wrangler pages secret put ADMIN_PASSWORD --project-name $pagesProject
npx wrangler pages secret put STATUS_REPORT_TOKEN --project-name $pagesProject
```

这些命令会交互式读取值，不要把密钥拼进命令行。

非敏感配置仍作为普通环境变量设置：`ADMIN_USERNAME`、`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BRANCH`。部署前确认 Production 和 Preview 环境没有残留旧密钥。

独立的状态 Worker 在 `status-worker` 目录设置密钥：

```powershell
Push-Location status-worker
npx wrangler secret put STATUS_REPORT_TOKEN
npx wrangler deploy
Pop-Location
```

登录接口使用 `LoginAttemptLimiter` Durable Object 持久化限制管理员密码尝试次数。部署 `status-worker` 后，在 Cloudflare Pages 项目的 **Settings → Functions → Durable Object bindings** 中为 Production 和 Preview 都添加绑定：变量名 `LOGIN_ATTEMPT_LIMITER`，Worker 选择 `chlors-presence`，类选择 `LoginAttemptLimiter`。然后重新部署 Pages。每个 Cloudflare 客户端 IP 对每个管理员账号每 10 分钟最多校验 5 次；成功登录会清零该来源的计数。Pages 必须保留 Cloudflare 注入的 `CF-Connecting-IP` 请求头；未配置绑定、缺少客户端 IP 或限速服务不可用时，登录会明确失败并返回服务不可用。

部署后访问 `/console/`，登录后选择 Markdown 正文、填写元数据并点击“发布到网站”。Function 会将文件写入 `src/content/posts/`，GitHub push 会自动触发 Cloudflare Pages 构建。

## 本地状态上报

1. 在 Cloudflare Pages 项目的 KV bindings 中创建变量 `STATUS_KV` 并绑定一个 KV namespace。
2. Pages Function 和独立 Worker 使用同一个新建的 `STATUS_REPORT_TOKEN`。
3. 主站生产地址是 `https://chlors.cn`；状态上报器运行 `status-reporter/install.ps1` 时，`Status API URL` 输入 `https://status.chlors.cn`，再输入同一个 token。安装器会把 token 以当前 Windows 用户可解密的 DPAPI 形式保存到 `%LOCALAPPDATA%\NaichunSitePresenceReporter\settings.json`。
4. 安装器会创建登录时启动的计划任务 `NaichunSitePresenceReporter`。运行 `status-reporter/uninstall.ps1` 可移除任务并删除本机加密设置。

状态程序仅上传 Steam 客户端是否运行、网易云媒体会话的播放状态、歌曲名和上报时间。超过 45 秒没有上报时，网站自动显示离线。
