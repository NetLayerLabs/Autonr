"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bars3Icon,
  BeakerIcon,
  BugAntIcon,
  KeyIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { ProofSearch } from "~~/components/autonr/ProofSearch";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const menuLinks: HeaderMenuLink[] = [
  { label: "Mission control", href: "/", icon: <Squares2X2Icon className="h-4 w-4" /> },
  { label: "Audit", href: "/audit", icon: <ShieldCheckIcon className="h-4 w-4" /> },
  { label: "Playground", href: "/playground", icon: <BeakerIcon className="h-4 w-4" /> },
  { label: "Owner", href: "/owner", icon: <KeyIcon className="h-4 w-4" /> },
  { label: "Debug", href: "/debug", icon: <BugAntIcon className="h-4 w-4" /> },
];

const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`nav-link ${isActive ? "liquid-glass" : ""}`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  const closeBurgerMenu = () => burgerMenuRef.current?.removeAttribute("open");
  useOutsideClick(burgerMenuRef, closeBurgerMenu);

  // The bar is transparent over the page top and frosts once content scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div
      className={`site-nav sticky top-0 navbar min-h-0 shrink-0 justify-between gap-2 z-20 px-2 py-3 sm:px-4 ${
        scrolled ? "is-scrolled" : ""
      }`}
    >
      <div className="navbar-start w-auto">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary
            className="btn btn-ghost btn-sm h-10 min-h-10 w-10 p-0 xl:hidden hover:bg-transparent"
            aria-label="Open navigation"
          >
            <Bars3Icon className="h-5 w-5" />
          </summary>
          <div className="nav-sheet dropdown-content mt-3 flex w-72 flex-col gap-2 p-2.5">
            <ProofSearch className="md:hidden" onNavigate={closeBurgerMenu} />
            <ul className="menu menu-compact w-full gap-0.5 p-0" onClick={closeBurgerMenu}>
              <HeaderMenuLinks />
            </ul>
          </div>
        </details>
        <Link
          href="/"
          aria-label="Autonr home"
          className="flex items-center gap-2.5 ml-1 xl:ml-2 mr-2 sm:mr-6 shrink-0"
        >
          <Image alt="" src="/autonr-mark.svg" width={29} height={28} priority className="h-7 w-auto" />
          <Image alt="Autonr" src="/autonr-word.png" width={78} height={18} priority className="h-[18px] w-auto" />
        </Link>
        <ul className="hidden xl:flex xl:flex-nowrap items-center gap-1 m-0 p-0 list-none">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end grow gap-3">
        <ProofSearch className="hidden md:block xl:hidden 2xl:block w-full max-w-72" />
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
