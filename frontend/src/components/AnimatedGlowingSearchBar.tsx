import { Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnimatedGlowingSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder?: string;
}

export function AnimatedGlowingSearchBar({
  value,
  onChange,
  onSubmit,
  placeholder = "What do you need done? e.g. 'translate a document to Arabic'",
}: AnimatedGlowingSearchBarProps) {
  return (
    <form onSubmit={onSubmit} className="mt-10 max-w-3xl mx-auto">
      <div className="glow-search-wrap rounded-xl p-[1px]">
        <div className="relative rounded-[11px] border border-border/80 bg-surface/95 backdrop-blur-sm">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full h-14 pl-14 pr-32 text-base bg-transparent rounded-[11px] focus:outline-none focus:ring-2 focus:ring-ring/35 transition placeholder:text-muted-foreground/70"
          />
          <Button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Search
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </form>
  );
}
