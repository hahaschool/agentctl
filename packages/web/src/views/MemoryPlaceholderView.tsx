'use client';

import type React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function MemoryPlaceholderView({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="p-6 md:p-8">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{description}</p>
          <p>
            This route is part of the memory foundation chunk. The page shell is ready, but the
            full workflow UI lands in later chunks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
