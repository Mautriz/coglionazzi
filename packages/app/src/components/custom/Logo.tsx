import { cn } from "~/lib/classUtils";

/** Brand lockup: glossy neon-purple gradient tile (the "arcade" brand skin —
 *  see lib/theme.ts) housing the mascot — a chubby nerd with fat glasses
 *  clutching a game controller — next to a chunky rounded wordmark.
 *  Inline SVG so it scales crisply and follows the theme. */
export function Logo({
  className,
  size = "md",
  textClassName,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Extra classes for the wordmark — e.g. hide it on small screens. */
  textClassName?: string;
}) {
  const px = { sm: 30, md: 46, lg: 68 }[size];
  const text = { sm: "text-xl", md: "text-3xl", lg: "text-5xl" }[size];

  return (
    <span
      className={cn("inline-flex items-center gap-3 select-none", className)}
    >
      <NerdIcon size={px} />
      <span
        className={cn(
          "font-display font-bold tracking-tight text-foreground",
          text,
          textClassName,
        )}
      >
        Coglionazzi
      </span>
    </span>
  );
}

export function NerdIcon({ size = 46 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="coglionazzi"
    >
      <defs>
        <linearGradient
          id="cog-tile"
          x1="0"
          y1="0"
          x2="0"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#a855f7" />
          <stop offset="1" stopColor="#7e22ce" />
        </linearGradient>
        <radialGradient id="cog-gloss" cx="0.28" cy="0.22" r="0.9">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id="cog-skin"
          x1="0"
          y1="8"
          x2="0"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#ede9fe" />
        </linearGradient>
        <clipPath id="cog-clip">
          <rect x="0" y="0" width="64" height="64" rx="14" />
        </clipPath>
      </defs>

      {/* tile */}
      <rect x="0" y="0" width="64" height="64" rx="14" fill="url(#cog-tile)" />
      <g clipPath="url(#cog-clip)">
        <rect x="0" y="0" width="64" height="64" fill="url(#cog-gloss)" />

        {/* sparkles */}
        <circle cx="52" cy="11" r="3" fill="#FFFFFF" fillOpacity="0.22" />
        <circle cx="57.5" cy="17" r="1.6" fill="#FFFFFF" fillOpacity="0.18" />
        <circle cx="49" cy="6.5" r="1.2" fill="#FFFFFF" fillOpacity="0.16" />

        {/* ground shadow */}
        <ellipse
          cx="32"
          cy="57.5"
          rx="18"
          ry="3.6"
          fill="#1c0f2b"
          fillOpacity="0.16"
        />

        {/* chubby body — wide pear, melts into the tile bottom */}
        <path
          d="M16.5 57 C16 44.5 22 35.5 32 35.5 C42 35.5 48 44.5 47.5 57 Z"
          fill="url(#cog-skin)"
        />

        {/* head — big, round, cheeky */}
        <circle cx="32" cy="22.5" r="14.5" fill="url(#cog-skin)" />

        {/* cowlick — two dorky loops */}
        <path
          d="M28.5 8.5 Q30.5 4.8 33.5 7.6"
          stroke="#1c0f2b"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M34 7.8 Q36.5 5.4 38 8.8"
          stroke="#1c0f2b"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />

        {/* FAT glasses — the statement piece */}
        <circle
          cx="24.5"
          cy="23"
          r="6.8"
          fill="#f3e8ff"
          fillOpacity="0.5"
          stroke="#1c0f2b"
          strokeWidth="2.7"
        />
        <circle
          cx="39.5"
          cy="23"
          r="6.8"
          fill="#f3e8ff"
          fillOpacity="0.5"
          stroke="#1c0f2b"
          strokeWidth="2.7"
        />
        <path
          d="M31.1 21.8 Q32 20.6 32.9 21.8"
          stroke="#1c0f2b"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M17.9 21.6 L16.4 20.2"
          stroke="#1c0f2b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M46.1 21.6 L47.6 20.2"
          stroke="#1c0f2b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* lens glints */}
        <path
          d="M21.3 20.6 L24.1 18.3"
          stroke="#FFFFFF"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.95"
        />
        <path
          d="M36.3 20.6 L39.1 18.3"
          stroke="#FFFFFF"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.95"
        />

        {/* eyes */}
        <circle cx="24.7" cy="23.6" r="1.8" fill="#1c0f2b" />
        <circle cx="39.7" cy="23.6" r="1.8" fill="#1c0f2b" />
        <circle cx="25.3" cy="23" r="0.6" fill="#FFFFFF" />
        <circle cx="40.3" cy="23" r="0.6" fill="#FFFFFF" />

        {/* blush */}
        <ellipse
          cx="19.5"
          cy="29"
          rx="2.6"
          ry="1.5"
          fill="#e879f9"
          opacity="0.55"
        />
        <ellipse
          cx="44.5"
          cy="29"
          rx="2.6"
          ry="1.5"
          fill="#e879f9"
          opacity="0.55"
        />

        {/* goofy grin + buck teeth */}
        <path
          d="M27 30.8 Q32 35 37 30.8"
          stroke="#1c0f2b"
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
        />
        <rect
          x="30.1"
          y="31.6"
          width="3.8"
          height="3.1"
          rx="0.9"
          fill="#FFFFFF"
          stroke="#1c0f2b"
          strokeWidth="0.9"
        />
        <path
          d="M32 31.8 L32 34.5"
          stroke="#1c0f2b"
          strokeWidth="0.7"
          strokeLinecap="round"
        />

        {/* stubby arms reaching the controller */}
        <path
          d="M18.5 45 Q19.5 49.5 24.5 49"
          stroke="#ede9fe"
          strokeWidth="4.6"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M45.5 45 Q44.5 49.5 39.5 49"
          stroke="#ede9fe"
          strokeWidth="4.6"
          strokeLinecap="round"
          fill="none"
        />

        {/* game controller */}
        <rect
          x="23.5"
          y="44.5"
          width="17"
          height="8.4"
          rx="4.2"
          fill="#1c0f2b"
        />
        {/* d-pad */}
        <path
          d="M28 46.6 L28 50.8 M25.9 48.7 L30.1 48.7"
          stroke="#f3e8ff"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* buttons */}
        <circle cx="36.2" cy="47.4" r="1.25" fill="#a855f7" />
        <circle cx="38.6" cy="49.8" r="1.25" fill="#e879f9" />
        {/* hands gripping the ends */}
        <circle cx="23.6" cy="48.7" r="2.5" fill="url(#cog-skin)" />
        <circle cx="40.4" cy="48.7" r="2.5" fill="url(#cog-skin)" />
      </g>
    </svg>
  );
}
