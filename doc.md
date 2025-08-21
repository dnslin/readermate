# VS Code 小说阅读插件完整开发方案

## 一、项目概述

### 1.1 项目目标

开发一个轻量级的 VS Code 插件，通过调用 hectorqin/reader 服务端 API，实现工作时间的便捷小说阅读功能。

### 1.2 核心需求

- 显示个人书架
- 点击书籍进入阅读
- 支持快捷键翻页
- 界面简洁，不影响工作

## 二、技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────┐
│           VS Code Extension         │
├─────────────────────────────────────┤
│  Extension Host (Node.js)           │
│  ├── API Client (HTTP请求)          │
│  ├── Data Manager (数据管理)        │
│  └── Command Handler (命令处理)     │
├─────────────────────────────────────┤
│  UI Layer                          │
│  ├── TreeView (书架)               │
│  ├── Webview (阅读器)              │
│  └── Status Bar (状态栏)           │
├─────────────────────────────────────┤
│  Reader API Server                 │
│  └── HTTP: /reader3/*              │
└─────────────────────────────────────┘
```

### 2.2 技术栈

- **开发语言**: TypeScript
- **UI 框架**: VS Code Extension API
- **网络请求**: Node.js http/https
- **数据存储**: VS Code 配置 API + globalState

## 三、功能设计

### 3.1 功能模块

**书架管理模块**

- 获取书架列表
- 书籍信息展示
- 刷新书架

**阅读器模块**

- 章节列表获取
- 章节内容显示
- 翻页控制

**配置管理模块**

- 服务器地址配置
- 用户登录信息
- 阅读偏好设置

**快捷键模块**

- 翻页快捷键
- 界面切换
- 快速操作

### 3.2 API 接口设计

**基础配置**

- 服务器地址: `http://your-reader-server:8080`
- API 前缀: `/reader3/`
- 认证方式: Token

**核心 API**

```
GET  /reader3/getUserInfo           # 获取用户信息
GET  /reader3/getBookshelf         # 获取书架
GET  /reader3/getChapterList       # 获取章节列表
GET  /reader3/getBookContent       # 获取章节内容
POST /reader3/saveBookProgress     # 保存阅读进度
```

## 四、项目结构

### 4.1 目录结构

```
novel-reader-vscode/
├── package.json                 # 插件配置
├── tsconfig.json               # TypeScript配置
├── src/
│   ├── extension.ts            # 插件入口
│   ├── api/
│   │   ├── readerApi.ts        # API客户端
│   │   └── types.ts            # 类型定义
│   ├── providers/
│   │   ├── bookshelfProvider.ts # 书架数据提供者
│   │   └── readerProvider.ts   # 阅读器提供者
│   ├── views/
│   │   ├── bookshelf.ts        # 书架视图
│   │   └── reader.ts           # 阅读器视图
│   ├── commands/
│   │   └── index.ts            # 命令处理
│   └── utils/
│       ├── config.ts           # 配置管理
│       └── storage.ts          # 存储管理
├── media/
│   ├── reader.css              # 阅读器样式
│   ├── reader.js               # 阅读器脚本
│   └── icons/                  # 图标资源
└── README.md
```
