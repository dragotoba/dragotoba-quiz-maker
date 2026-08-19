import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AccountButton from "@/components/AccountButton";
import { SymbolIcon } from "@/components/SymbolIcon";
import { SYMBOLS, type IconSymbol } from "@/data/icons-data";
import dragotobaLogo from "@/assets/dragotoba-logo.png";

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type IconSets = {
  circleSet: IconSymbol[];
  bar1Set: IconSymbol[];
  bar2Set: IconSymbol[];
};

const CIRCLE_RADIUS = 172;
const CIRCLE_COUNT = 15;

export default function Index() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<IconSets | null>(null);

  useEffect(() => {
    const half = Math.ceil(SYMBOLS.length / 2);
    setSets({
      circleSet: shuffle(SYMBOLS).slice(0, CIRCLE_COUNT),
      bar1Set: shuffle(SYMBOLS).slice(0, half),
      bar2Set: shuffle(SYMBOLS).slice(0, half),
    });
  }, []);

  const bar1Items = sets ? [...sets.bar1Set, ...sets.bar1Set] : [];
  const bar2Items = sets ? [...sets.bar2Set, ...sets.bar2Set] : [];

  return (
    <main className="qh-page relative flex min-h-screen w-full flex-col overflow-hidden font-[Poppins,sans-serif]">
      <div className="absolute top-6 right-8 z-[5] flex items-center gap-3">
        <a
          href="https://dragotoba.com"
          className="flex items-center gap-3 text-inherit no-underline hover:opacity-80"
        >
          <span className="text-sm font-semibold tracking-[0.02em] text-[#33302b]">
            A Product Of Dragotoba Studios
          </span>
          <img
            src={dragotobaLogo}
            alt="Dragotoba Studios"
            className="h-12 w-12 object-contain"
          />
        </a>
        <AccountButton />
      </div>

      {sets && (
        <>
          <div className="mt-24 h-[72px] w-full overflow-hidden">
            <div className="qh-marquee-slow flex h-full w-max items-center gap-14 pr-14">
              {bar1Items.map((sym, i) => (
                <div key={`b1-${sym.id}-${i}`} className="h-8 w-8 shrink-0">
                  <SymbolIcon symbol={sym} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center gap-9 py-6">
            <h1 className="text-center font-[Poppins,sans-serif] text-4xl font-bold tracking-[0.01em] text-[#2f5d76]">
              Dragotoba Quiz Maker
            </h1>
            <div className="qh-orbit relative h-[420px] w-[420px]">
              <div className="qh-spin absolute inset-0">
                {sets.circleSet.map((sym, i) => {
                  const angle = (360 / sets.circleSet.length) * i;
                  return (
                    <div
                      key={`c-${sym.id}-${i}`}
                      className="absolute top-1/2 left-1/2"
                      style={{
                        transform: `translate(-50%, -50%) rotate(${angle}deg) translate(0px, -${CIRCLE_RADIUS}px)`,
                      }}
                    >
                      <div className="qh-spin-rev h-[34px] w-[34px]">
                        <SymbolIcon symbol={sym} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="cursor-pointer rounded-full border-none bg-[#2f5d76] px-10 py-5 font-[Poppins,sans-serif] text-[19px] font-bold tracking-[0.01em] text-[#f8fafc] shadow-[0_6px_18px_rgba(0,0,0,0.15)]"
                >
                  Create Your Quiz
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate("/community")}
              className="cursor-pointer rounded-full border-none bg-[#2f5d76] px-[34px] py-4 font-[Poppins,sans-serif] text-base font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
            >
              View Community Quizzes
            </button>
          </div>

          <div className="mb-8 h-[72px] w-full overflow-hidden">
            <div className="qh-marquee-fast flex h-full w-max items-center gap-14 pr-14">
              {bar2Items.map((sym, i) => (
                <div key={`b2-${sym.id}-${i}`} className="h-8 w-8 shrink-0">
                  <SymbolIcon symbol={sym} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
