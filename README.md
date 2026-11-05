# CineNest 家庭影院

自托管的影视聚合面板（单容器）。**本身不带片源**：在首页右上角「设置」里填影视源接口，豆瓣数据做首页与详情，自动按片名匹配片源播放。

## 功能
- 首页推荐轮播；电影 / 剧集 / 动漫 / 综艺独立分类（剧集含「短剧」）
- 详情页：海报、评分、简介与演职员；选集；系列作品（其他季）与相关推荐
- 多线路自动测速、换源，m3u8 去广告，网页 PiP
- 竖屏短剧 9:16 自适应；iPhone 网页模拟横屏全屏
- 每天 04:00 在本机测速影视源，连不上的不删除只排后；网页「设置 → 影视源状态」可手动重新检测

## 安装
支持 x86_64 与 ARM（arm64 / armv7），需要 Docker + compose。

```sh
sh install.sh          # 默认端口 8899
sh install.sh 9000     # 自定义端口
```

访问 `http://设备IP:8899`，点右上角齿轮：首次在局域网内设置管理密码，再填接口地址（可多个，可填 GitHub 代理），保存后 1–3 分钟测速完成即可播放。

## 配置
- 接口格式：CineNest（`{"sites":[{"name","api"}]}`）、TVBox（type 0/1 的 CMS 站）、MoonTV/LunaTV（`api_site`）、或每行 `名称,地址` 的纯文本
- 公共接口示例：`https://raw.githubusercontent.com/zknjjjx/tvbox/main/cmstv.json`（[zknjjjx/tvbox](https://github.com/zknjjjx/tvbox) 每天自动汇集，未验活）
- 也可编辑 `data/extra.txt` 补充，每行一个 `名称,接口地址`
- `docker-compose.yml` 环境变量：`RUN_AT`（每日检测时间）、`ALLOW_ADULT`（1=保留成人站点，默认 0）
- 升级：在安装目录执行 `docker compose pull && docker compose up -d`（或再次执行 `sh install.sh`）
- 镜像：`zknjjjx/cinenest`（Docker Hub，amd64 / arm64 / armv7），推送到 main 后由 GitHub Actions 自动构建

## 声明
仅供学习与个人使用。请只播放你拥有或获得授权的内容，并遵守当地版权法律。
