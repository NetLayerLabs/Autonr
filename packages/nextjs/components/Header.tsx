"use client";

import React, { useRef } from "react";
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
              className={`${
                isActive ? "bg-primary/10 text-primary font-semibold" : "hover:bg-primary/5"
              } py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col transition-colors whitespace-nowrap`}
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

  return (
    <div className="sticky xl:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between gap-2 z-20 shadow-sm border-b border-base-300 px-0 sm:px-2">
      <div className="navbar-start w-auto">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost xl:hidden hover:bg-transparent" aria-label="Open navigation">
            <Bars3Icon className="h-1/2" />
          </summary>
          <div className="dropdown-content mt-3 flex w-72 flex-col gap-2 rounded-box bg-base-100 p-2 shadow-sm">
            <ProofSearch className="md:hidden" onNavigate={closeBurgerMenu} />
            <ul className="menu menu-compact w-full p-0" onClick={closeBurgerMenu}>
              <HeaderMenuLinks />
            </ul>
          </div>
        </details>
        <Link href="/" className="hidden sm:flex items-center gap-3 ml-2 xl:ml-4 mr-4 shrink-0">
          <div className="flex relative w-9 h-9">
            <Image alt="Hedera icon" className="cursor-pointer dark:hidden" fill src="/Hedera-Icon-Dark.svg" />
            <Image alt="Hedera icon" className="cursor-pointer hidden dark:block" fill src="/Hedera-Icon-White.svg" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold leading-tight text-base">Autonr</span>
            <span className="text-[10px] tracking-wider uppercase text-base-content/60 font-medium">
              Built on Hedera
            </span>
          </div>
        </Link>
        <ul className="hidden xl:flex xl:flex-nowrap menu menu-horizontal px-1 gap-1">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end grow gap-3 mr-4">
        <ProofSearch className="hidden md:block w-full max-w-72" />
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
