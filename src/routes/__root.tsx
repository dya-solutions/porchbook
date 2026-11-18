import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";

/** The page stays hidden until it has its newest look (saved covers, keys, shelf), then fades in, so old looks never flash. */
function Unveil() {
  useEffect(() => {
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => document.documentElement.classList.remove("porch-booting"));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
import { AuthProvider } from "@/lib/auth/provider";
import { PrayerBed } from "@/components/porch/prayer";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";
import utilCss from "../tailwind-utilities.css?url";
import "../styles.css";
import "../tailwind-utilities.css";

const APP_NAME = "Porchbook";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Welcome to Porchbook. A community of communion with other believers in the Lord Jesus Christ.",
      },
      { name: "theme-color", content: "#000000" },
      { name: "color-scheme", content: "dark" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: utilCss },
      { rel: "icon", type: "image/png", href: "/mark.png?v=4" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://www.youtube-nocookie.com" },
      { rel: "preconnect", href: "https://www.youtube.com" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('porch-booting');try{if(localStorage.getItem('porch-top-style')==='glass')document.documentElement.classList.add('top-glass');if(localStorage.getItem('porch-postbox-style')==='porchbook')document.documentElement.classList.add('pb-green');if(localStorage.getItem('porch-button-style')==='green')document.documentElement.classList.add('btn-green');if(localStorage.getItem('porch-bar-style')==='leather')document.documentElement.classList.add('bars-leather')}catch(e){}try{var b=localStorage.getItem('porch-bright');if(b==null||b===''){var legacy=localStorage.getItem('porch-feel');b=legacy==='lamp'?'8':legacy==='quiet'?'46':'100';}var n=parseInt(b,10);if(!(n>=0&&n<=100))n=100;var t=n/100;document.documentElement.style.setProperty('--porch-dim',((1-t)*0.9).toFixed(3));document.documentElement.style.setProperty('--porch-gain',(1+Math.pow(t,1.5)*1.05).toFixed(3));document.documentElement.style.setProperty('--porch-wash',(Math.pow(t,2.4)*0.48).toFixed(3));delete document.documentElement.dataset.feel;var fl=document.createElement('link');fl.rel='stylesheet';fl.href='https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&display=swap';fl.media='print';fl.onload=function(){this.media='all'};document.head.appendChild(fl);setTimeout(function(){try{localStorage.removeItem('porch-shelf');['hide','door','ground'].forEach(function(k){var raw=localStorage.getItem('porch-'+k);if(!raw||raw.length>500000)return;var saved=JSON.parse(raw);if(saved&&saved.image&&saved.image.length<400000)document.documentElement.style.setProperty('--porch-'+k,'url(\"data:'+(saved.mime||'image/jpeg')+';base64,'+saved.image+'\")')});var shelf=localStorage.getItem('porch-shelf2');if(shelf&&shelf.length<500000){var savedShelf=JSON.parse(shelf);if(savedShelf&&savedShelf.image&&savedShelf.image.length<400000)document.documentElement.style.setProperty('--porch-shelf','url(\"data:'+(savedShelf.mime||'image/jpeg')+';base64,'+savedShelf.image+'\")')}}catch(e){}},1)}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <PrayerBed />
          <Unveil />
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
