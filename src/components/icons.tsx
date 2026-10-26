import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function Pen({ size, className, d }: IconProps & { d: string }) {
  return (
    <Svg size={size} className={className}>
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 8h15M13 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const IconToken = (p: IconProps) => <Pen {...p} d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 10h4" />;
export const IconDeploy = (p: IconProps) => <Pen {...p} d="M10 16V5M6.5 8.5 10 5l3.5 3.5M4 16.5h12" />;
export const IconExchange = (p: IconProps) => <Pen {...p} d="M4 7h10M12 4.5 14.5 7 12 9.5M16 13H6M8 10.5 5.5 13 8 15.5" />;
export const IconBridge = (p: IconProps) => <Pen {...p} d="M3.5 14V9.5a6.5 6.5 0 0 1 13 0V14M3.5 14h13M7 14v-2M13 14v-2" />;
export const IconMixer = (p: IconProps) => <Pen {...p} d="M6.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM13.5 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />;
export const IconProgram = (p: IconProps) => <Pen {...p} d="M7 4.5 3.5 10 7 15.5M13 4.5 16.5 10 13 15.5M11 4l-2 12" />;
export const IconApproval = (p: IconProps) => <Pen {...p} d="M6 9.5 8.5 12 14 6.5M4.5 16.5h11" />;
export const IconAlert = (p: IconProps) => <Pen {...p} d="M10 3.5 17 16.5H3L10 3.5zM10 8.5v3.5M10 14.2v.3" />;
export const IconClock = (p: IconProps) => <Pen {...p} d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM10 6.5V10l2.5 1.5" />;
export const IconLink = (p: IconProps) => <Pen {...p} d="M8 12 12 8M8.5 6.5l.8-.8a3 3 0 0 1 4.2 4.2l-.8.8M11.5 13.5l-.8.8a3 3 0 0 1-4.2-4.2l.8-.8" />;
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="4" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5 13.5H4.5A1.5 1.5 0 0 1 3 12V4.5A1.5 1.5 0 0 1 4.5 3H12a1.5 1.5 0 0 1 1.5 1.5V5" stroke="currentColor" strokeWidth="1.5" />
  </Svg>
);
export const IconShare = (p: IconProps) => <Pen {...p} d="M8 10.5 12.5 7M8 10.5 12.5 14M5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14.5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14.5 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />;
export const IconExport = (p: IconProps) => <Pen {...p} d="M10 3.5v8M6.5 7 10 3.5 13.5 7M4.5 12.5v2h11v-2" />;
export const IconSearch = (p: IconProps) => <Pen {...p} d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.5 13.5 17 17" />;
export const IconPlus = (p: IconProps) => <Pen {...p} d="M10 4v12M4 10h12" />;
export const IconCompose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.5 3.8 16.2 8.5 7.2 17.5H3.5v-3.7L11.5 3.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M9.6 5.7 14.3 10.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);
export const IconSend = (p: IconProps) => <Pen {...p} d="M10 15.5V5M6 8.5 10 4.5 14 8.5" />;
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" />
  </Svg>
);
export const IconMenu = (p: IconProps) => <Pen {...p} d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />;
export const IconClose = (p: IconProps) => <Pen {...p} d="M5 5l10 10M15 5 5 15" />;
export const IconPin = (p: IconProps) => <Pen {...p} d="M7 3.5h6l-1 5 2.5 2H5.5L8 8.5l-1-5zM10 10.5V16.5" />;
export const IconTrash = (p: IconProps) => <Pen {...p} d="M4.5 6h11M8 6V4.5h4V6M7 6l.5 10h5L13 6" />;
export const IconEdit = (p: IconProps) => <Pen {...p} d="M12.5 4.5 15.5 7.5 7 16H4v-3l8.5-8.5z" />;
export const IconCheck = (p: IconProps) => <Pen {...p} d="M4.5 10.5 8 14 15.5 6" />;
export const IconArrow = (p: IconProps) => <Pen {...p} d="M4 10h12M11 5.5 15.5 10 11 14.5" />;
export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.2" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9.8 10H16.2M13.6 10v2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);
export const IconSidebar = (p: IconProps) => <Pen {...p} d="M4 4.5h12v11H4zM8 4.5v11" />;
export const IconAttach = (p: IconProps) => <Pen {...p} d="M8.2 10.2 12.6 5.8a2.2 2.2 0 0 1 3.1 3.1l-5.6 5.6a3.2 3.2 0 0 1-4.5-4.5l5.2-5.2" />;
export const IconChat = (p: IconProps) => <Pen {...p} d="M4 5.5h12v8H8l-3 2.5v-2.5H4z" />;
export const IconBook = (p: IconProps) => <Pen {...p} d="M4.5 4.5h5.2A2.3 2.3 0 0 1 12 6.8V16a2 2 0 0 0-2.3-1.6H4.5zM15.5 4.5H10.3A2.3 2.3 0 0 0 8 6.8V16a2 2 0 0 1 2.3-1.6h5.2z" />;
export const IconPackage = (p: IconProps) => <Pen {...p} d="M10 3.5 16 6.5v7L10 16.5 4 13.5v-7zM10 3.5v13M4 6.5 10 9.5 16 6.5" />;
export const IconPeople = (p: IconProps) => <Pen {...p} d="M7 8.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM13.5 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 16c.4-2 1.8-3.2 3.5-3.2S10.1 14 10.5 16M10 16c.3-1.6 1.4-2.6 2.8-2.6 1.5 0 2.6 1 3 2.6" />;
export const IconBuilding = (p: IconProps) => <Pen {...p} d="M4 16.5h12M6 16.5V6.5L10 4l4 2.5v10M8.5 9h.5M11 9h.5M8.5 12h.5M11 12h.5" />;
export const IconAgent = (p: IconProps) => <Pen {...p} d="M10 3.5v2M6.5 7.5h7v6h-7zM8.5 10.2h.5M11 10.2h.5M8 16.5h4M7 13.5 5.5 15M13 13.5 14.5 15" />;
export const IconShield = (p: IconProps) => <Pen {...p} d="M10 3.5 16 6v4.2c0 3.2-2.3 5.2-6 6.8-3.7-1.6-6-3.6-6-6.8V6z" />;
export const IconLock = (p: IconProps) => <Pen {...p} d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v7H5z" />;
export const IconCite = (p: IconProps) => <Pen {...p} d="M7 7.5H4.5V14H8M13 7.5h2.5V14H12M8 10.5c.4-2 1.2-3 2-3s1.6 1 2 3" />;

export function FindingIcon({ id, size = 18 }: { id: string; size?: number }) {
  if (id.includes("delegate") || id.includes("freeze") || id.includes("approv")) return <IconApproval size={size} />;
  if (id.includes("burst") || id.includes("fail") || id.includes("frozen")) return <IconAlert size={size} />;
  if (id.includes("fund") || id.includes("single")) return <IconBridge size={size} />;
  if (id.includes("history") || id.includes("activity")) return <IconClock size={size} />;
  if (id.includes("rugcheck")) return <IconToken size={size} />;
  if (id.includes("mint") || id.includes("program") || id.includes("identity")) return <IconProgram size={size} />;
  if (id.includes("label")) return <IconToken size={size} />;
  return <IconWallet size={size} />;
}
