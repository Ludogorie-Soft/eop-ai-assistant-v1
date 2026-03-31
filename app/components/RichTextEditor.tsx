'use client';

import { useRef, useEffect, useCallback } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange?: (html: string) => void;
  onUserInput?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  height?: string;
  aiHighlight?: boolean;
  className?: string;
}

const HIGHLIGHT_COLORS = [
  { color: '#fef9c3', label: 'Жълто' },
  { color: '#dcfce7', label: 'Зелено' },
  { color: '#dbeafe', label: 'Синьо' },
  { color: '#fce7f3', label: 'Розово' },
  { color: '#fed7aa', label: 'Оранжево' },
];

function toDisplayHtml(value: string): string {
  if (!value) return '';
  if (value.startsWith('<') || value.includes('<br') || value.includes('<p') || value.includes('<div')) {
    return value;
  }
  return value.replace(/\n/g, '<br>');
}

export function RichTextEditor({
  value,
  onChange,
  onUserInput,
  readOnly = false,
  placeholder = '',
  height = '16rem',
  aiHighlight = false,
  className = '',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync prop value → innerHTML only for external (non-user) updates
  useEffect(() => {
    if (!editorRef.current) return;
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    editorRef.current.innerHTML = toDisplayHtml(value);
  }, [value]);

  const emitChange = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? '';
    lastValueRef.current = html;
    onChange?.(html);
  }, [onChange]);

  const handleInput = useCallback(() => {
    onUserInput?.();
    emitChange();
  }, [onUserInput, emitChange]);

  const exec = useCallback(
    (command: string, val?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, val);
      emitChange();
    },
    [emitChange],
  );

  // Read-only display
  if (readOnly) {
    return (
      <div
        className={`mt-3 w-full overflow-auto rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 ${className}`}
        style={{ height, textAlign: 'justify', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: toDisplayHtml(value) || `<span style="color:#9ca3af">${placeholder}</span>` }}
      />
    );
  }

  return (
    <>
      <style>{`
        .rich-editor-content:empty::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
      <div
        className={`mt-3 w-full rounded-md border ${
          aiHighlight
            ? 'border-yellow-300 ring-2 ring-yellow-200'
            : 'border-neutral-300 focus-within:border-neutral-500 focus-within:ring-1 focus-within:ring-neutral-500'
        } overflow-hidden transition-all duration-300 ${className}`}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-2 py-1">
          <ToolbarBtn onClick={() => exec('bold')} title="Получер">
            <span className="font-bold">B</span>
          </ToolbarBtn>
          <ToolbarBtn onClick={() => exec('italic')} title="Курсив">
            <span className="italic">I</span>
          </ToolbarBtn>
          <ToolbarBtn onClick={() => exec('underline')} title="Подчертано">
            <span className="underline">U</span>
          </ToolbarBtn>
          <ToolbarBtn onClick={() => exec('strikeThrough')} title="Зачертано">
            <span className="line-through">S</span>
          </ToolbarBtn>

          <Divider />

          {/* Text color */}
          <label
            className="relative flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-sm hover:bg-neutral-200"
            title="Цвят на текст"
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="font-semibold leading-none">A</span>
            <span className="h-1 w-3 rounded-sm" style={{ background: '#000', marginTop: 2 }} />
            <input
              ref={colorInputRef}
              type="color"
              defaultValue="#000000"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={(e) => {
                if (colorInputRef.current) {
                  const bar = colorInputRef.current.previousElementSibling as HTMLElement;
                  if (bar) bar.style.background = e.target.value;
                }
                exec('foreColor', e.target.value);
              }}
            />
          </label>

          <Divider />

          {/* Highlight colors */}
          <span className="mr-0.5 text-xs text-neutral-400">Маркер:</span>
          {HIGHLIGHT_COLORS.map(({ color, label }) => (
            <button
              key={color}
              type="button"
              onClick={() => exec('hiliteColor', color)}
              className="h-4 w-4 rounded-sm border border-neutral-300 transition-transform hover:scale-125"
              style={{ background: color }}
              title={label}
            />
          ))}
          <ToolbarBtn onClick={() => exec('hiliteColor', 'transparent')} title="Премахни маркиране">
            <span className="text-neutral-400">✕</span>
          </ToolbarBtn>

          <Divider />

          <ToolbarBtn onClick={() => exec('removeFormat')} title="Изчисти форматиране">
            <span className="text-xs text-neutral-500">Изчисти</span>
          </ToolbarBtn>
        </div>

        {/* Editable area */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          data-placeholder={placeholder}
          className={`rich-editor-content w-full overflow-y-auto px-3 py-2 text-sm text-neutral-800 outline-none transition-colors duration-300 ${
            aiHighlight ? 'bg-yellow-50' : 'bg-white'
          }`}
          style={{ height, textAlign: 'justify', wordBreak: 'break-word' }}
        />
      </div>
    </>
  );
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // keep focus in editor
        onClick();
      }}
      title={title}
      className="rounded px-1.5 py-0.5 text-sm hover:bg-neutral-200 active:bg-neutral-300"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-neutral-300" />;
}
