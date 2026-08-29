import Image from "next/image";

/**
 * The anniversary mark and the crests that go with it.
 *
 * The 125 mark carries black ring text ("BROTHERS OF ST.GABRIEL … 1901-2026"),
 * which would disappear against this app's navy stage. Rather than recolour an
 * official logo, it sits on its own light coin — see `.coin` in globals.css.
 */

const MARK = "/logos/anniversary-125.png";
const MARK_ALT =
  "Brothers of St. Gabriel, Province of Thailand — 125th anniversary, 1901–2026";

export function AnniversaryMark({
  size = 150,
  priority = false,
  className = "",
}: {
  size?: number;
  /** Set on the menu hero, which is the first thing anyone sees. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`coin relative grid shrink-0 place-items-center rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={MARK}
        alt={MARK_ALT}
        width={size}
        height={size}
        priority={priority}
        sizes={`${size}px`}
        className="h-[88%] w-[88%] object-contain"
      />
    </div>
  );
}

/** The crests behind the event, sized off their own artwork. */
export function Contributors({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-3 ${className}`}>
      <span className="text-xs font-medium text-white/35">สนับสนุนโดย</span>
      <Image
        src="/logos/act-1961.png"
        alt="ACT 1961"
        width={161}
        height={200}
        className="h-10 w-auto"
      />
      <Image
        src="/logos/act-innotech.png"
        alt="ACT Innotech Center"
        width={164}
        height={200}
        className="h-11 w-auto"
      />
    </div>
  );
}
