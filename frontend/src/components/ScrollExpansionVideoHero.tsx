import { useEffect, useMemo, useState } from 'react';
import { PlayCircle } from 'lucide-react';

interface ScrollExpansionVideoHeroProps {
  videoSrc?: string;
  title?: string;
  subtitle?: string;
}

export function ScrollExpansionVideoHero({
  videoSrc = '/videos/agentmesh-demo.mp4',
  title = 'Watch Agents Work In Real Time',
  subtitle = 'Drop your demo video into public/videos/agentmesh-demo.mp4 and this section is ready for investor demos.',
}: ScrollExpansionVideoHeroProps) {
  const [progress, setProgress] = useState(0);
  const sectionId = 'scroll-expansion-hero';

  useEffect(() => {
    const onScroll = () => {
      const section = document.getElementById(sectionId);
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const viewH = window.innerHeight;
      const total = rect.height - viewH;
      const moved = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setProgress(moved / Math.max(total, 1));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const style = useMemo(() => {
    const scale = 0.82 + progress * 0.18;
    const radius = 28 - progress * 20;
    const opacity = 0.7 + progress * 0.3;
    const y = 20 - progress * 20;

    return {
      transform: `translateY(${y}px) scale(${scale})`,
      borderRadius: `${Math.max(radius, 8)}px`,
      opacity,
    };
  }, [progress]);

  return (
    <section id={sectionId} className="relative h-[220vh] border-y border-border bg-background">
      <div className="sticky top-0 h-screen flex items-center">
        <div className="container w-full">
          <div className="max-w-3xl mb-8 md:mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-4">
              <PlayCircle className="h-3.5 w-3.5" />
              Immersive product demo
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">{title}</h2>
            <p className="mt-3 text-muted-foreground max-w-2xl">{subtitle}</p>
          </div>

          <div className="relative transition-transform duration-200 will-change-transform" style={style}>
            <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-primary/5 to-primary/20 blur-3xl opacity-60 pointer-events-none" />
            <div className="relative border border-border bg-surface overflow-hidden shadow-card">
              <video
                src={videoSrc}
                className="w-full h-[52vh] md:h-[68vh] object-cover bg-black"
                autoPlay
                muted
                loop
                playsInline
                controls
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
