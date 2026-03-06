'use client';

import { CheckCircle2, Circle, ListTodo } from 'lucide-react';

import { cn } from '@/lib/utils';

type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
};

type TodoBlockProps = {
  content: string;
  timestamp?: string;
};

export function TodoBlock({ content, timestamp }: TodoBlockProps): React.JSX.Element {
  let todos: TodoItem[] = [];
  try {
    todos = JSON.parse(content) as TodoItem[];
  } catch {
    return (
      <div className="px-3 py-2 rounded-lg border-l-[3px] bg-blue-500/[0.06] border-l-blue-400/60">
        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">Tasks</span>
        <div className="text-[12px] text-muted-foreground mt-1">Unable to parse task list</div>
      </div>
    );
  }

  if (!Array.isArray(todos) || todos.length === 0) {
    return (
      <div className="px-3 py-2 rounded-lg border-l-[3px] bg-blue-500/[0.06] border-l-blue-400/60">
        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">Tasks</span>
        <div className="text-[12px] text-muted-foreground mt-1">No tasks</div>
      </div>
    );
  }

  const completed = todos.filter((t) => t.status === 'completed').length;

  return (
    <div className="px-3 py-2 rounded-lg border-l-[3px] bg-blue-500/[0.06] border-l-blue-400/60">
      <div className="flex items-center gap-2 mb-1.5">
        <ListTodo size={12} className="text-blue-600 dark:text-blue-400 shrink-0" />
        <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">Tasks</span>
        <span className="text-[10px] text-muted-foreground">
          {completed}/{todos.length} complete
        </span>
        {timestamp && (
          <span className="text-[10px] text-muted-foreground ml-auto">{timestamp}</span>
        )}
      </div>
      <div className="space-y-0.5">
        {todos.map((todo, i) => (
          <div key={todo.id ?? String(i)} className="flex items-start gap-2 text-[12px]">
            {todo.status === 'completed' ? (
              <CheckCircle2
                size={13}
                className="shrink-0 mt-0.5 text-green-600 dark:text-green-400"
              />
            ) : (
              <Circle size={13} className="shrink-0 mt-0.5 text-muted-foreground" />
            )}
            <span
              className={cn(
                'leading-relaxed',
                todo.status === 'completed'
                  ? 'text-muted-foreground line-through'
                  : 'text-foreground/90',
              )}
            >
              {todo.content}
            </span>
            {todo.priority && todo.priority !== 'medium' && (
              <span
                className={cn(
                  'text-[9px] shrink-0 px-1 py-0.5 rounded',
                  todo.priority === 'high'
                    ? 'text-red-600 dark:text-red-400 bg-red-400/10'
                    : 'text-muted-foreground bg-muted',
                )}
              >
                {todo.priority}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
