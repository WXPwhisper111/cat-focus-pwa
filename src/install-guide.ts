import images from './install-guide-images.json';
export const installBrowsers = [
  ['edge', 'Android Edge'], ['safari', 'iPhone / iPad Safari'],
  ['android', '通用 Android 浏览器'], ['huawei', '华为浏览器'], ['xiaomi', '小米浏览器'],
  ['oppo', 'OPPO 浏览器'], ['vivo', 'vivo 浏览器'], ['quark', '夸克浏览器'], ['other', '其他浏览器'],
] as const;
export type InstallBrowser = typeof installBrowsers[number][0];
type ImageId = keyof typeof images;
type Step = { title: string; text: string; image?: ImageId };
export function initialInstallBrowser(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints): InstallBrowser {
  if (/iPad|iPhone|iPod/i.test(ua) || /Mac/i.test(platform) && touch > 1) return 'safari';
  return /Android/i.test(ua) ? 'edge' : 'other';
}
export function guideSteps(browser: InstallBrowser): Step[] {
  if (browser === 'edge') return [
    {title:'打开 Edge 菜单',text:'使用 Android Edge 打开当前网址，点击浏览器菜单；若在微信等应用内，请先复制网址到 Edge。',image:'edge-menu'},
    {title:'向左滑动菜单',text:'在菜单功能区域向左滑，查看下一页入口。',image:'edge-swipe'},
    {title:'添加至手机',text:'找到并点击“添加至手机”。',image:'edge-add'},
    {title:'优先选择安装',text:'点击“安装”，按系统提示完成。“创建快捷方式”可能仍在浏览器内打开，与安装体验不同。',image:'edge-install'},
    {title:'从桌面打开',text:'返回桌面查看猫咪图标，点开后即可使用。',image:'edge-result'},
  ];
  if (browser === 'safari') return [
    {title:'打开分享菜单',text:'在 iPhone 或 iPad 上使用 Safari 打开当前网址，点击分享按钮；位置可能随系统版本不同。',image:'safari-share'},
    {title:'添加到主屏幕',text:'在分享菜单中向下查找“添加到主屏幕”。',image:'safari-add'},
    {title:'确认添加',text:'按系统提示确认名称并添加，再从桌面打开；若未找到入口，可检查分享菜单中的更多操作。'},
  ];
  return [
    {title:'在浏览器中打开',text:'用所选浏览器直接打开当前网址，避免停留在聊天应用内置浏览器。'},
    {title:'查找安装入口',text:'打开浏览器菜单，查找“安装应用”“添加到桌面”“添加到主屏幕”或类似选项。菜单因设备和版本不同。'},
    {title:'按提示确认',text:'可能添加的是网页快捷方式。若使用不顺畅，Android 可尝试 Edge，iPhone / iPad 可尝试 Safari；电脑也可查看地址栏安装入口。'},
  ];
}
export function installSteps(browser: InstallBrowser) { return guideSteps(browser).map(step => step.text); }
export function renderGuide(list: HTMLOListElement, browser: InstallBrowser, showImage: (id: ImageId, title: string, opener: HTMLButtonElement) => void) {
  const imageButton = (id: ImageId, title: string, lazy: boolean) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'install-shot'; button.setAttribute('aria-label', `查看完整图片：${title}`);
    const image = document.createElement('img'); const asset = images[id]; image.src = asset.src; image.width = asset.width; image.height = asset.height; image.alt = title; image.loading = lazy ? 'lazy' : 'eager'; image.decoding = 'async';
    const hint = document.createElement('span'); hint.textContent = '点击查看完整图片';
    image.onerror = () => { image.hidden = true; hint.textContent = '图片暂时无法加载，请按上方文字操作'; button.disabled = true; };
    button.append(image, hint); button.onclick = () => showImage(id, title, button); return button;
  };
  list.replaceChildren(...guideSteps(browser).map((step, index) => {
    const item = document.createElement('li'), heading = document.createElement('h3'), text = document.createElement('p');
    heading.textContent = `${index + 1}. ${step.title}`; text.textContent = step.text; item.append(heading, text);
    if (step.image) item.append(imageButton(step.image, step.title, index > 0));
    return item;
  }));
  if (browser === 'edge') {
    const details = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('p');
    summary.textContent = '安装后桌面没有图标？'; text.textContent = '部分 Android 系统需要允许 Edge 创建桌面快捷方式。可在系统应用权限中查找相关设置，名称与路径因手机不同；无需开启图中其他无关权限。';
    details.append(summary, text, imageButton('edge-permission', '桌面快捷方式权限示例', true)); list.after(details); details.dataset.guideTroubleshoot = '';
  }
}
export function fullGuideImage(id: ImageId, title: string) {
  const image = document.createElement('img'), asset = images[id]; image.src = asset.src; image.alt = title; image.width = asset.width; image.height = asset.height;
  image.onerror = () => { image.alt = '图片暂时无法加载，请返回步骤查看文字说明'; }; return image;
}
