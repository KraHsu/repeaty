import { escape, type SiteBuild } from './model'
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
export async function createPreview(build: SiteBuild, signal?: AbortSignal) {
  const searchSource = build.files.find((file) => file.path === 'search-index.js')
  let searchItems: { title: string; text: string; fields: string; path: string }[] = []
  if (searchSource) {
    try {
      const raw = text(searchSource.bytes)
        .replace(/^window\.__REPEATY_PUBLIC_SEARCH__\s*=\s*/u, '')
        .replace(/;\s*$/u, '')
      const items = JSON.parse(raw)
      if (Array.isArray(items))
        searchItems = items.filter(
          (item) =>
            item &&
            typeof item.title === 'string' &&
            typeof item.path === 'string' &&
            build.pages.some((page) => page.path === item.path),
        )
    } catch {
      /* An edited theme can omit the default search index. */
    }
  }
  const urls = new Map<string, string>()
  // A sandbox without allow-same-origin has an opaque origin and cannot read the host's
  // blob URLs. FileReader creates bounded media data URLs asynchronously without weakening
  // the iframe sandbox or granting the theme access to the application.
  for (const file of build.files)
    if (/^(image\/(png|jpeg|gif|webp|avif)|audio\/|video\/|font\/)/u.test(file.type)) {
      signal?.throwIfAborted()
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        const abort = () => reader.abort()
        signal?.addEventListener('abort', abort, { once: true })
        reader.onloadend = () => signal?.removeEventListener('abort', abort)
        reader.onabort = () => reject(new DOMException('预览已取消。', 'AbortError'))
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('预览附件无法读取，请重新生成。'))
        reader.readAsDataURL(new Blob([new Uint8Array(file.bytes)], { type: file.type }))
      })
      urls.set(file.path, value)
    }
  signal?.throwIfAborted()
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const resolve = (page: string, reference: string) => {
    try {
      const url = new URL(reference, 'https://preview.invalid/' + page)
      return url.origin === 'https://preview.invalid'
        ? decodeURIComponent(url.pathname.slice(1))
        : undefined
    } catch {
      return undefined
    }
  }
  return {
    render(path: string, fragment = '') {
      const file = build.files.find(
        (item) => item.path === path && item.type.startsWith('text/html'),
      )
      if (!file) throw new Error('预览页面不存在。')
      const document = new DOMParser().parseFromString(text(file.bytes), 'text/html')
      document.querySelectorAll('script,base,meta[http-equiv]').forEach((node) => node.remove())
      for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
        const target = resolve(path, link.getAttribute('href') ?? '')
        const style = build.files.find(
          (item) => item.path === target && item.type.startsWith('text/css'),
        )
        if (style) {
          const node = document.createElement('style')
          node.textContent = text(style.bytes).replace(
            /url\(\s*(['"]?)(.*?)\1\s*\)/giu,
            (_match, _quote, reference: string) => {
              const resource = resolve(style.path, reference)
              return `url("${resource && urls.has(resource) ? urls.get(resource) : ''}")`
            },
          )
          link.replaceWith(node)
        } else link.remove()
      }
      for (const element of document.querySelectorAll('[src],[poster]'))
        for (const attribute of ['src', 'poster']) {
          const original = element.getAttribute(attribute)
          if (!original) continue
          const target = resolve(path, original),
            url = target ? urls.get(target) : undefined
          if (url) element.setAttribute(attribute, url)
          else element.removeAttribute(attribute)
        }
      document
        .querySelectorAll('img[loading]')
        .forEach((image) => image.setAttribute('loading', 'eager'))
      for (const link of document.querySelectorAll('a[href]')) {
        const original = link.getAttribute('href')!
        const target = resolve(path, original)
        link.removeAttribute('target')
        if (original.startsWith('#')) continue
        if (target && build.pages.some((item) => item.path === target)) {
          link.setAttribute('data-preview-page', target)
          const hash = new URL(original, 'https://preview.invalid/' + path).hash.slice(1)
          if (hash) {
            try {
              link.setAttribute('data-preview-fragment', decodeURIComponent(hash))
            } catch {
              /* Invalid fragments do not block the page. */
            }
          }
          link.setAttribute('href', '#')
        } else link.removeAttribute('href')
      }
      // The theme's scripts never execute in the application. Only this navigation bridge does.
      document
        .querySelectorAll('#site-search button')
        .forEach((button) => button.setAttribute('type', 'button'))
      const policy = document.createElement('meta')
      policy.httpEquiv = 'Content-Security-Policy'
      policy.content = `default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`
      document.head.prepend(policy)
      const script = document.createElement('script')
      script.setAttribute('nonce', nonce)
      const publicSearch = JSON.stringify(searchItems).replaceAll('<', '\\u003c')
      script.textContent = `document.addEventListener('click',e=>{const a=e.target.closest('[data-preview-page]');if(a){e.preventDefault();parent.postMessage({type:'repeaty-site-preview',page:a.dataset.previewPage},'*')}});const items=${publicSearch};document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id!=='site-search')return;const query=document.getElementById('query'),list=document.getElementById('search-results'),status=document.getElementById('search-status');if(!query||!list||!status)return;const term=query.value.trim().toLocaleLowerCase();const results=term?items.filter(item=>(item.title+' '+item.text+' '+item.fields).toLocaleLowerCase().includes(term)).slice(0,100):[];list.replaceChildren();status.textContent=term?results.length+' 篇文章':'输入关键词搜索';for(const item of results){const row=document.createElement('li'),a=document.createElement('a');a.textContent=item.title;a.href='#';a.dataset.previewPage=item.path;row.append(a);list.append(row)}});`
      // Serialize the detached script before attaching it: browsers hide the nonce attribute
      // after insertion, which would otherwise make the navigation bridge fail CSP.
      script.textContent += `document.addEventListener('click',e=>{if(e.target.closest('#site-search button')){e.preventDefault();document.getElementById('site-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}});document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('#site-search')){e.preventDefault();document.getElementById('site-search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}});`
      script.textContent += `document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(a&&!a.dataset.previewPage){e.preventDefault();try{document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))?.scrollIntoView()}catch{}}});document.getElementById(${JSON.stringify(fragment).replaceAll('<', '\\u003c')})?.scrollIntoView();`
      script.textContent = script.textContent.replace(
        "page:a.dataset.previewPage},'*'",
        "page:a.dataset.previewPage,fragment:a.dataset.previewFragment},'*'",
      )
      const bridge = script.outerHTML
      return (
        '<!doctype html>' +
        document.documentElement.outerHTML.replace('</body>', bridge + '</body>')
      )
    },
    dispose() {
      urls.clear()
    },
  }
}
export const emptyPreview = (label: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><p>${escape(label)}</p></body></html>`
