import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { GlobalCommandPalette } from './GlobalCommandPalette';

interface LayoutProps {
  children: React.ReactNode;
  noFooter?: boolean;
}

export function Layout({ children, noFooter }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <GlobalCommandPalette />
      <main className="flex-1">{children}</main>
      {!noFooter && <Footer />}
    </div>
  );
}
