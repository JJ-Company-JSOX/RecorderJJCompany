# Jsox Recorder 官网

中文静态桌面应用下载网站；不提供云端 AI 或声音克隆，不接收视频或声音样本，无遥测、外部字体或 CDN 依赖。Firebase 项目绑定为用户提供的 `d-recorder-ef064`，配置文件不是登录授权，也不表示已经上线。

## 本地检查

需要 Node.js。网站本身没有 npm 运行依赖。

```sh
cd website
npm run check
npm run build
npm run dev
```

浏览器回归（在仓库根目录，先启动网站服务）：

```sh
node website/test/smoke.mjs
```

回归使用桌面项目已有的 Playwright 和 `/usr/bin/chromium`；其他系统可设置 JSOX_BROWSER。

## Firebase 登录与发布

在你自己电脑的终端运行（需要 Node.js 与可访问 Google 的网络）：

```sh
npx firebase-tools login
```

浏览器选择拥有 `d-recorder-ef064` 权限的 Google 账号。不要把生成的凭据、验证码或令牌发给别人。然后在仓库的 website 文件夹执行：

```sh
npx firebase-tools projects:list
npx firebase-tools deploy --only hosting --project d-recorder-ef064
```

发布命令会更新该项目默认 Hosting 站点；如果已经承载其他网站，先确认站点用途。这里只部署 Hosting，不创建数据库、Functions 或 AI 服务，不需要为声音克隆购买服务器。Firebase 额度与计费以控制台为准。配置安全响应头；发布清单不缓存。

## 安装包发布

修改 public/downloads.json：仅为完成平台验证的版本填写真实 HTTPS 下载地址、文件字节数、SHA-256、版本号和对应版本完整源代码 URL。未满足条件的下载保持禁用。不要把上游安装包或原生辅助 exe 当成 Jsox 安装包。源代码须包含修改、必要构建文件及适用许可说明。

## 中国电脑验收

不能用云端 Linux 或海外网络的通过结果代替实际中国电脑测试。

1. 记录 Windows/macOS 版本、CPU、RAM、架构、所在网络；不要记录手机号或公网 IP。
2. 用当地网络打开实际发布域名，检查首页、图片、清单与安装包下载分别是否成功，记录耗时与失败信息。Firebase 在大陆的可达性尚未验证；如不稳定，使用同一套静态文件评估合适的国内托管及其域名/备案要求。
3. 安装匹配架构的真实安装包，记录签名/系统提示与首次启动情况。
4. 断网后录制一段含麦克风的 30 秒操作；检查捕获权限、光标、导入、剪辑、保存工程、重新打开与 MP4 导出，以及音画同步。
5. 检查中文路径与用户名、8 GB 内存设备表现；不要把未测试平台写成“支持已验证”。

当前证据：网站语法检查、构建与 Chromium 桌面/移动布局、导航、示意播放、禁用下载与恶意下载 URL 拒绝已通过。未发布 Firebase；未测试大陆网络或当地电脑安装。桌面端开发工作与官网发布分开验收。
