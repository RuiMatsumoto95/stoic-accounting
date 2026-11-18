"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 閾値に達するまでは通常のリンククリックとして扱う。
export function getNavDragScroll(startX: number, currentX: number, startScrollLeft: number): number | null {
  const distance = currentX - startX;
  return Math.abs(distance) >= 5 ? startScrollLeft - distance : null;
}

export function canStartNavDrag(pointerType: string, button: number, scrollWidth: number, clientWidth: number): boolean {
  return pointerType === "mouse" && button === 0 && scrollWidth > clientWidth;
}

type NavDrag = {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  dragging: boolean;
};

export const links = [
  { href: "/journals", label: "仕訳日記帳" },
  { href: "/ledger", label: "総勘定元帳" },
  { href: "/trial-balance", label: "残高試算表（貸借）" },
  { href: "/pl-trial-balance", label: "残高試算表（損益）" },
  { href: "/subsidiary-ledger", label: "補助元帳" },
  { href: "/subsidiary-balance", label: "補助残高一覧" },
  { href: "/tax-summary", label: "消費税集計表" },
  { href: "/income-statement", label: "損益計算書" },
  { href: "/balance-sheet", label: "貸借対照表" },
  { href: "/csv-import", label: "CSVインポート" },
  { href: "/opening-balances", label: "期首残高" },
  { href: "/settings", label: "設定" },
];

export default function NavLinks() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef<NavDrag | null>(null);
  const suppressClick = useRef(false);
  const [canScroll, setCanScroll] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const updateOverflow = () => {
      const overflowing = nav.scrollWidth > nav.clientWidth;
      setCanScroll(overflowing);
      if (!overflowing) {
        const pointerId = drag.current?.pointerId;
        drag.current = null;
        setDragging(false);
        if (pointerId !== undefined && nav.hasPointerCapture(pointerId)) nav.releasePointerCapture(pointerId);
      }
    };
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(nav);
    for (const link of nav.children) observer.observe(link);
    return () => observer.disconnect();
  }, []);

  const endDrag = (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    // pointercancel の後には click は発生しない。
    if (cancelled) suppressClick.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <nav
      ref={navRef}
      className={`min-w-0 flex-1 px-6 h-14 flex items-center gap-6 text-sm whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${canScroll ? `select-none [&_a]:cursor-inherit ${dragging ? "cursor-grabbing" : "cursor-grab"}` : ""}`}
      onDragStart={e => e.preventDefault()}
      onPointerDown={e => {
        // 前の操作が capture 喪失で中断されても、新しいクリックは妨げない。
        suppressClick.current = false;
        if (!canStartNavDrag(e.pointerType, e.button, e.currentTarget.scrollWidth, e.currentTarget.clientWidth)) return;
        drag.current = { pointerId: e.pointerId, startX: e.clientX, startScrollLeft: e.currentTarget.scrollLeft, dragging: false };
      }}
      onPointerMove={e => {
        const current = drag.current;
        if (!current || current.pointerId !== e.pointerId) return;
        if ((e.buttons & 1) === 0) { endDrag(e, true); return; }
        const scrollLeft = getNavDragScroll(current.startX, e.clientX, current.startScrollLeft);
        if (!current.dragging && scrollLeft === null) return;
        if (!current.dragging) {
          current.dragging = true;
          suppressClick.current = true;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        e.preventDefault();
        e.currentTarget.scrollLeft = current.startScrollLeft - (e.clientX - current.startX);
      }}
      onPointerUp={e => endDrag(e)}
      onPointerCancel={e => endDrag(e, true)}
      onPointerLeave={() => {
        // 閾値前は capture しないため、外で離した候補を残さない。
        if (drag.current && !drag.current.dragging) drag.current = null;
      }}
      onLostPointerCapture={e => {
        if (drag.current?.pointerId !== e.pointerId) return;
        drag.current = null;
        setDragging(false);
        // 正常終了後にも発火するので、直後の click 抑止はここでは消さない。
      }}
      onClickCapture={e => {
        const suppress = suppressClick.current;
        suppressClick.current = false;
        // キーボード操作（detail=0）は中断後もそのまま通す。
        if (!suppress || e.detail === 0) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Link
        href="/"
        draggable={false}
        aria-current={pathname === "/" ? "page" : undefined}
        className={`shrink-0 font-semibold text-foreground${pathname === "/" ? " font-bold underline underline-offset-4" : ""}`}
      >
        Stoic Accounting
      </Link>
      {links.map(({ href, label }) => {
        const isActive = pathname === href;

        return (
          <Link
            key={href}
            href={href}
            draggable={false}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 transition-colors ${isActive ? "font-bold text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
