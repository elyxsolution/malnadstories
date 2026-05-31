import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Malnad Stories</h1>
        <p className="text-lg text-muted-foreground">
          Turn your travel memories into beautiful printed photo albums.
          Upload photos, arrange pages, and order — delivered anywhere in India.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button render={<Link href="/signup" />} size="lg">
            Create your album
          </Button>
          <Button render={<Link href="/login" />} variant="outline" size="lg">
            Log in
          </Button>
        </div>
      </div>
    </main>
  );
}
