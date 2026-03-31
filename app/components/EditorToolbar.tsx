'use client';

import type { Editor } from '@tiptap/react';

const HIGHLIGHT_COLORS = [
  { color: '#fef9c3', label: 'Жълто' },
  { color: '#dcfce7', label: 'Зелено' },
  { color: '#dbeafe', label: 'Синьо' },
  { color: '#fce7f3', label: 'Розово' },
  { color: '#fed7aa', label: 'Оранжево' },
];

export function EditorToolbar({ editor }: { editor: Editor }) {
  const run = (fn: () => void) => fn();

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-2 py-1">
      <Btn onClick={() => run(() => editor.chain().focus().toggleBold().run())} active={editor.isActive('bold')} title="Получер">
        <span className="font-bold">B</span>
      </Btn>
      <Btn onClick={() => run(() => editor.chain().focus().toggleItalic().run())} active={editor.isActive('italic')} title="Курсив">
        <span className="italic">I</span>
      </Btn>
      <Btn onClick={() => run(() => editor.chain().focus().toggleUnderline().run())} active={editor.isActive('underline')} title="Подчертано">
        <span className="underline">U</span>
      </Btn>
      <Btn onClick={() => run(() => editor.chain().focus().toggleStrike().run())} active={editor.isActive('strike')} title="Зачертано">
        <span className="line-through">S</span>
      </Btn>

      <Sep />

      <label
        className="relative flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-sm hover:bg-neutral-200"
        title="Цвят на текст"
        onMouseDown={(e) => e.preventDefault()}
      >
        <span className="font-semibold">A</span>
        <span
          className="h-1 w-3 rounded-sm"
          style={{ background: editor.getAttributes('textStyle').color ?? '#000', marginTop: 2 }}
        />
        <input
          type="color"
          defaultValue="#000000"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>

      <Sep />

      <span className="mr-0.5 text-xs text-neutral-400">Маркер:</span>
      {HIGHLIGHT_COLORS.map(({ color, label }) => (
        <button
          key={color}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleHighlight({ color }).run();
          }}
          className="h-4 w-4 rounded-sm border border-neutral-300 transition-transform hover:scale-125"
          style={{ background: color }}
          title={label}
        />
      ))}
      <Btn onClick={() => editor.chain().focus().unsetHighlight().run()} title="Премахни маркиране">
        <span className="text-neutral-400">✕</span>
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Изчисти форматиране">
        <span className="text-xs text-neutral-500">Изчисти</span>
      </Btn>
    </div>
  );
}

function Btn({ onClick, title, active = false, children }: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`rounded px-1.5 py-0.5 text-sm hover:bg-neutral-200 active:bg-neutral-300 ${active ? 'bg-neutral-200 font-semibold' : ''}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-1 h-4 w-px bg-neutral-300" />;
}
