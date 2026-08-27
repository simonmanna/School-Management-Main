import { useEffect, useRef } from 'react';
import { Bold, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Rich-text editor for teacher-authored content (L2.4).
 *
 * Deliberately a small `contenteditable` rather than a full editor dependency:
 * the HTML it emits is sanitised **server-side on write**
 * (`moodle/util/sanitize.ts`), so the editor is a convenience, not a security
 * boundary. Nothing here is trusted — a teacher pasting a `<script>` gets it
 * stripped at the API, not by this component.
 */
export function RichText({
  value, onChange, rows = 5, placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only write into the DOM when the incoming value genuinely differs, or every
  // keystroke would reset the caret to the start of the field.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value ?? '';
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? '');
  };

  const addLink = () => {
    const url = window.prompt('Link URL');
    if (!url) return;
    // Only http(s) — `javascript:` in an href is the classic stored-XSS vector.
    // The server strips it too; refusing here just avoids a confusing round trip.
    if (!/^https?:\/\//i.test(url)) {
      window.alert('Links must start with http:// or https://');
      return;
    }
    exec('createLink', url);
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1">
        <ToolButton title="Bold" onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Italic" onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Underline" onClick={() => exec('underline')}><Underline className="h-3.5 w-3.5" /></ToolButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Quote" onClick={() => exec('formatBlock', 'blockquote')}><Quote className="h-3.5 w-3.5" /></ToolButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton title="Link" onClick={addLink}><Link2 className="h-3.5 w-3.5" /></ToolButton>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight: `${rows * 1.5}rem` }}
        className="prose prose-sm dark:prose-invert max-w-none px-3 py-2 text-sm focus:outline-none"
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onBlur={() => onChange(ref.current?.innerHTML ?? '')}
        // Paste as plain text: pasting from Word otherwise drags in a mass of
        // style markup that the sanitiser then strips, leaving odd results.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          onChange(ref.current?.innerHTML ?? '');
        }}
      />
    </div>
  );
}

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button" variant="ghost" size="icon" className="h-7 w-7" title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
