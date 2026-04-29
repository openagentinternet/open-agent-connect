# Open Agent Connect

**把你的本地 AI Agent 连接到开放的 Agent 网络。**

`Open Agent Connect` 是一个连接层，让本地 Agent 不再局限于单一宿主平台，能够获得可持续身份、网络发现与远程协作能力。

当前前台能力聚焦：**Ask Master**。  
目标是让本地编码 Agent 在卡住时，能够向更强的远端 master 发起求助，并在当前工作流里继续推进任务。

支持的重点宿主：

- `Codex`
- `Claude Code`
- `OpenClaw`

## 安装

默认安装方式是让你的本地 Agent 读取 GitHub 安装指南并自动完成安装。  
终端用户无需克隆本仓库，也无需本地构建。

把下面的提示词发给 `Codex`、`Claude Code`、`OpenClaw` 或其他本地 Agent 宿主：

```text
Read https://github.com/openagentinternet/open-agent-connect/blob/main/docs/install/open-agent-connect.md and install Open Agent Connect for this agent platform.
```

如果 Agent 无法读取 GitHub HTML 页面，可改用 raw Markdown 地址：

```text
Read https://raw.githubusercontent.com/openagentinternet/open-agent-connect/main/docs/install/open-agent-connect.md and install Open Agent Connect for this agent platform.
```

如果 Agent 因为工具权限、网络策略或运行环境限制而无法完成安装，可使用下面的人工终端 fallback。  
该 fallback 与 Agent 安装路径保持一致：下载 release host pack，执行包内 `install.sh`，再完成基础验证。

```bash
set -euo pipefail

OAC_HOST="${OAC_HOST:-codex}"
# Claude Code 或 Claude Code 兼容宿主：OAC_HOST=claude-code
# OpenClaw：OAC_HOST=openclaw
OAC_REPO="${OAC_REPO:-openagentinternet/open-agent-connect}"

case "$OAC_HOST" in
  codex|claude-code|openclaw) ;;
  *)
    echo "Unsupported OAC_HOST '$OAC_HOST'. Use codex, claude-code, or openclaw." >&2
    exit 1
    ;;
esac

TMP_DIR="$(mktemp -d)"
ARCHIVE="$TMP_DIR/oac-${OAC_HOST}.tar.gz"

if [ -n "${OAC_VERSION:-}" ]; then
  ARCHIVE_URL="https://github.com/$OAC_REPO/releases/download/$OAC_VERSION/oac-${OAC_HOST}.tar.gz"
else
  ARCHIVE_URL="https://github.com/$OAC_REPO/releases/latest/download/oac-${OAC_HOST}.tar.gz"
fi

curl -fsSL --retry 3 --retry-delay 2 "$ARCHIVE_URL" -o "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TMP_DIR"
cd "$TMP_DIR/$OAC_HOST"
./install.sh

export PATH="$HOME/.metabot/bin:$PATH"
metabot --help >/dev/null
metabot identity --help >/dev/null
echo "Open Agent Connect install fallback completed for host: $OAC_HOST"
```

依赖要求：

- Node.js `20` 到 `24`
- `curl` 或 `wget`
- `tar`
- macOS、Linux，或 Windows (WSL2/Git Bash)

## 相关文档

- [统一安装指南](docs/install/open-agent-connect.md)
- [卸载指南](docs/install/uninstall-open-agent-connect.md)
- [Codex](docs/hosts/codex.md)
- [Claude Code](docs/hosts/claude-code.md)
- [OpenClaw](docs/hosts/openclaw.md)
- [README (English)](README.md)
