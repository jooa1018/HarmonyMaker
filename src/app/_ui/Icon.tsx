import type { CSSProperties, ReactNode } from "react";
const paths: Record<string, ReactNode> = {
"headphones": <><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/></>,
"lock": <><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></>,
"camera": <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13.5" r="3.5"></circle></>,
"right": <><path d="M9 6l6 6-6 6"></path></>,
"check": <><path d="M5 12.5l4.5 4.5L19 7.5"></path></>,
"play": <><path d="M8 5.5v13l11-6.5z"></path></>,
"pause": <><rect x="6.5" y="5.5" width="4" height="13" rx="1"></rect><rect x="13.5" y="5.5" width="4" height="13" rx="1"></rect></>,
"share": <><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"></path><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path></>,
"download": <><path d="M12 3v12M7.5 10.5L12 15l4.5-4.5"></path><path d="M5 20h14"></path></>,
"refresh": <><path d="M20 11.5A8 8 0 1 0 17.7 17"></path><path d="M20 5v6.5h-6.5"></path></>,
"alert": <><path d="M12 4.5l8.5 15h-17z"></path><path d="M12 10v4.5M12 17.3v.2"></path></>,
"stop": <><circle cx="12" cy="12" r="8.5"></circle><path d="M8.5 15.5l7-7"></path></>,
"ask": <><circle cx="12" cy="12" r="8.5"></circle><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.6v.2"></path></>,
"copy": <><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></>,
"x": <><path d="M6 6l12 12M18 6L6 18"></path></>,
"trash": <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path></>,
"chat": <><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"></path></>,
"music": <><path d="M9 18V5l11-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="17" cy="16" r="3"></circle></>,
"flag": <><path d="M5 21V4M5 4h11l-2 4 2 4H5"></path></>,
"eye": <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="2.8"></circle></>
};
export function Icon({name, className = "", style}: {name: string; className?: string; style?: CSSProperties}) { return <svg className={`hm-icon ${className}`} style={style} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>; }
