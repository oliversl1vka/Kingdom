// KingdomOS — the site. Hero → scroll-scrubbed "Boot" transition → quickstart
// docs (with every per-step animation). This is the single canonical build.
import { Hero } from "@/components/Hero";
import { Bridge } from "@/components/Bridge";
import { Docs } from "@/components/Docs";

export default function HomePage() {
  return (
    <main>
      <Hero variant={1} scrollCue />
      <Bridge />
      <Docs hideIntro />
    </main>
  );
}
