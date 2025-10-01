#!/bin/bash

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_message() {
    echo -e "${2}${1}${NC}"
}

print_message "🔄 启动 Wedecode Online Workspace 服务..." $CYAN

# 切换到工作目录
cd /workspace

# 确保工作区目录存在
print_message "📁 检查工作目录..." $YELLOW
mkdir -p /workspace/workspaces
mkdir -p /workspace/uploads
mkdir -p /workspace/output

# 检查依赖是否已安装
if [ ! -d "node_modules" ]; then
    print_message "📦 检测到缺少依赖，正在安装..." $YELLOW
    if command -v pnpm &> /dev/null; then
        pnpm install
    else
        npm install
    fi
    print_message "✅ 依赖安装完成" $GREEN
fi

# 检查项目是否已构建
if [ ! -d "dist" ]; then
    print_message "🔨 检测到项目未构建，正在构建..." $YELLOW
    if command -v pnpm &> /dev/null; then
        pnpm run build
    else
        npm run build
    fi
    print_message "✅ 项目构建完成" $GREEN
fi

# 显示欢迎信息
print_message "" $NC
print_message "🎉 Wedecode 开发环境已就绪！" $GREEN
print_message "" $NC
print_message "📱 Web 界面: http://localhost:3000" $CYAN
print_message "🔧 工作空间: /workspace/workspaces" $CYAN
print_message "📁 上传目录: /workspace/uploads" $CYAN
print_message "" $NC
print_message "💡 快速命令:" $GREEN
print_message "  - 启动开发服务器: pnpm run ui $BLUE
print_message "  - 运行反编译工具: pnpm run start" $BLUE
print_message "  - 构建项目: pnpm run build" $BLUE
print_message "" $NC
print_message "📖 详细使用指南: .devcontainer/CODESPACES_GUIDE.md" $YELLOW
print_message "" $NC

# 自动启动 UI 界面
print_message "🚀 正在启动 Wedecode UI 界面..." $CYAN
if command -v pnpm &> /dev/null; then
    pnpm run ui &
else
    npm run ui &
fi

# 等待服务器启动
sleep 5
print_message "✅ Wedecode UI 已启动！请在端口面板中找到端口 3000 并打开" $GREEN
print_message "" $NC