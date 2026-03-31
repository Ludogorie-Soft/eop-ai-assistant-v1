'use client';

import { useEffect, useRef } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';

export function toEditorHtml(value: string): string {
  if (!value) return '';
  if (value.startsWith('<')) return value;
  return value
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

interface UseRichEditorOptions {
  value: string;
  onChange?: (html: string) => void;
  onUserInput?: () => void;
  placeholder?: string;
  height?: string;
  editable?: boolean;
  aiHighlight?: boolean;
}

export function useRichEditor({
  value,
  onChange,
  onUserInput,
  placeholder = '',
  height = '16rem',
  editable = true,
  aiHighlight = false,
}: UseRichEditorOptions) {
  const lastEmittedRef = useRef(value);
  const isProgrammaticRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onUserInputRef = useRef(onUserInput);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onUserInputRef.current = onUserInput; }, [onUserInput]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: toEditorHtml(value),
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: buildEditorClass(editable, aiHighlight),
        style: `height:${height};`,
      },
    },
    onUpdate: ({ editor }) => {
      if (isProgrammaticRef.current) return;
      const html = editor.getHTML();
      lastEmittedRef.current = html;
      onUserInputRef.current?.();
      onChangeRef.current?.(html);
    },
  });

  // Sync external value into editor without moving the cursor
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    const html = toEditorHtml(value);
    if (editor.getHTML() === html) return;
    isProgrammaticRef.current = true;
    editor.commands.setContent(html, { emitUpdate: false });
    isProgrammaticRef.current = false;
    lastEmittedRef.current = value;
  }, [editor, value]);

  // Sync aiHighlight background
  useEffect(() => {
    if (!editor || !editable) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: buildEditorClass(editable, aiHighlight),
          style: `height:${height};`,
        },
      },
    });
  }, [editor, aiHighlight, height, editable]);

  return editor;
}

function buildEditorClass(editable: boolean, aiHighlight: boolean): string {
  const bg = !editable ? 'bg-neutral-50' : aiHighlight ? 'bg-yellow-50' : 'bg-white';
  return `tiptap-editor px-3 py-2 text-sm text-neutral-800 transition-colors duration-300 ${bg}`;
}
