'use client';

import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Eye, FolderOpen, Save, Sparkles } from 'lucide-react';
import { Button } from '../primitives/button';
import { useNotify } from '../notify/NotifyProvider';

const Editor = dynamic(() => import('@monaco-editor/react'), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-muted-foreground">Loading editor…</div>
});

interface MonacoEditorProps {
    language?: string;
    value?: string;
    onChange?: (value: string | undefined) => void;
    height?: string;
    onGeneratePreview?: () => void;
    onSaveTemplate?: () => void;
    onLoadTemplate?: () => void;
    onFormatCode?: () => void;
}

export default function MonacoEditor({ language = 'javascript', value = '', onChange = () => {}, height = '500px', onGeneratePreview, onSaveTemplate, onLoadTemplate, onFormatCode }: MonacoEditorProps) {
    const notify = useNotify();
    const editorRef = useRef<any>(null);

    const handleEditorDidMount = (editor: any) => {
        editorRef.current = editor;
    };

    const handleFormatCode = () => {
        try {
            if (editorRef.current) {
                editorRef.current.getAction('editor.action.formatDocument').run();
                notify.success('Code formatted');
            }
        } catch {
            notify.error('Could not format the code');
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="mb-2 flex gap-2">
                {onGeneratePreview && (
                    <Button type="button" size="sm" variant="secondary" onClick={onGeneratePreview}>
                        <Eye />
                        Preview
                    </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={onFormatCode || handleFormatCode}>
                    <Sparkles />
                    Format
                </Button>
                {onSaveTemplate && (
                    <Button type="button" size="sm" onClick={onSaveTemplate}>
                        <Save />
                        Save
                    </Button>
                )}
                {onLoadTemplate && (
                    <Button type="button" size="sm" variant="outline" onClick={onLoadTemplate}>
                        <FolderOpen />
                        Load
                    </Button>
                )}
            </div>

            <div className="flex-1" style={{ height: `calc(${height} - 40px)` }}>
                <Editor
                    height="100%"
                    defaultLanguage={language}
                    language={language}
                    value={value}
                    onChange={onChange}
                    theme="vs-dark"
                    onMount={handleEditorDidMount}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        wordWrap: 'on',
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        formatOnPaste: true,
                        formatOnType: true,
                        suggest: {
                            showClasses: true,
                            showFunctions: true,
                            showVariables: true
                        },
                        scrollbar: {
                            vertical: 'auto',
                            horizontal: 'auto'
                        }
                    }}
                />
            </div>
        </div>
    );
}
