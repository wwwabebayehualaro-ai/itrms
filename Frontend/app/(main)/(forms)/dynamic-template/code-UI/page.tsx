'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Download, Eye, EyeOff, History, Save, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner, confirmAction, useNotify } from '@platform/ui';

/** Id for a template saved in this browser (called on save, never during render). */
const newTemplateId = () => Date.now().toString();

const MonacoEditor = dynamic(() => import('@platform/ui/code/MonacoEditor'), {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-muted-foreground">Loading editor…</div>
});

interface TemplateData {
    id: string;
    name: string;
    code: string;
    createdAt: string;
    category?: string;
}

const CATEGORIES = [
    { name: 'Dashboard', value: 'dashboard' },
    { name: 'Form', value: 'form' },
    { name: 'Data Display', value: 'data' },
    { name: 'Navigation', value: 'navigation' }
];

export default function PrimeReactEditorTemplate() {
    const notify = useNotify();
    const [code, setCode] = useState<string>(defaultTemplate);
    const [preview, setPreview] = useState<React.ReactNode>(null);
    const [templateName, setTemplateName] = useState<string>('My Template');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
    const [templates, setTemplates] = useState<TemplateData[]>([]);
    const [isTemplateLoading, setIsTemplateLoading] = useState(false);

    // Templates saved in this browser, read once after mounting (browser storage does not exist during server rendering).
    const [loadFailed, setLoadFailed] = useState(false);
    useEffect(() => {
        try {
            const savedTemplates = localStorage.getItem('primeTemplates');
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after hydration
            if (savedTemplates) setTemplates(JSON.parse(savedTemplates));
        } catch {
            setLoadFailed(true);
        }
    }, []);

    const generatePreview = () => {
        setIsPreviewLoading(true);
        try {
            const transformedCode = transformImports(code);
            const fullHtml = createPreviewHTML(transformedCode);
            setPreview(
                <iframe
                    srcDoc={fullHtml}
                    sandbox="allow-scripts allow-modals"
                    className="h-full w-full rounded-md"
                    title="Template Preview"
                    onLoad={() => setIsPreviewLoading(false)}
                    onError={() => {
                        showError('Failed to load preview');
                        setIsPreviewLoading(false);
                    }}
                />
            );
        } catch (error) {
            console.error('Preview generation error:', error);
            showError('Error generating preview');
            setIsPreviewLoading(false);
        }
    };

    const transformImports = (code: string): string => {
        // 1. Handle React imports
        let transformed = code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]react['"];/g, 'const {$1} = React;');

        // 2. Handle PrimeReact imports - use window.PrimeReact components directly
        transformed = transformed.replace(/import\s+\{([^}]+)\}\s+from\s+['"]primereact\/[^'"]+['"];/g, (match, imports) => {
            return imports
                .split(',')
                .map((imp: string) => imp.trim())
                .map((imp: string) => `const ${imp} = window.${imp};`)
                .join('\n');
        });

        // 3. Remove the export default but keep the component declaration
        transformed = transformed.replace(/export\s+default\s+(\w+);/g, 'window.$1 = $1;');

        return transformed;
    };

    const createPreviewHTML = (transformedCode: string): string => {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Template Preview</title>
    <link rel="stylesheet" href="https://unpkg.com/primereact@10.6.0/resources/themes/lara-light-indigo/theme.css">
    <link rel="stylesheet" href="https://unpkg.com/primereact@10.6.0/resources/primereact.min.css">
    <link rel="stylesheet" href="https://unpkg.com/primeicons@7.0.0/primeicons.css">
    <style>
        body { padding: 1rem; margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        #root { width: 100%; height: 100%; }
    </style>
</head>
<body>
    <div id="root"></div>

    <script src="https://unpkg.com/react@18.2.0/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone@7.21.4/babel.min.js"></script>

    <!-- Load individual PrimeReact components -->
    <script src="https://unpkg.com/primereact@10.6.0/components/inputtext/inputtext.min.js"></script>

    <script>
        // Initialize global PrimeReact components
        window.InputText = primereact.inputtext.InputText;
    </script>

    <script type="text/babel">
        ${transformedCode}

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(window.App));
    </script>
</body>
</html>
`;
    };

    const saveTemplate = () => {
        confirmAction({
            message: 'Are you sure you want to save this template?',
            header: 'Save Template',
            onAccept: () => performSave(),
            onReject: () => {}
        });
    };

    const performSave = () => {
        try {
            const templateData: TemplateData = {
                id: newTemplateId(),
                name: templateName,
                code: code,
                createdAt: new Date().toISOString(),
                category: selectedCategory.value
            };
            const updatedTemplates = [...templates, templateData];
            localStorage.setItem('primeTemplates', JSON.stringify(updatedTemplates));
            setTemplates(updatedTemplates);
            showSuccess('Template saved successfully!');
        } catch (error) {
            showError('Error saving template');
            console.error(error);
        }
    };

    const loadTemplate = (id?: string) => {
        setIsTemplateLoading(true);
        try {
            const templateToLoad = id ? templates.find((t) => t.id === id) : templates[templates.length - 1];
            if (templateToLoad) {
                setCode(templateToLoad.code);
                setTemplateName(templateToLoad.name);
                const category = CATEGORIES.find((c) => c.value === templateToLoad.category) || CATEGORIES[0];
                setSelectedCategory(category);
                showSuccess(`Template "${templateToLoad.name}" loaded`);
            } else {
                showWarning('No template found');
            }
        } catch (error) {
            showError('Error loading template');
            console.error(error);
        } finally {
            setIsTemplateLoading(false);
        }
    };

    const deleteTemplate = (id: string) => {
        confirmAction({
            message: 'Are you sure you want to delete this template?',
            header: 'Delete Template',
            onAccept: () => {
                const updatedTemplates = templates.filter((t) => t.id !== id);
                localStorage.setItem('primeTemplates', JSON.stringify(updatedTemplates));
                setTemplates(updatedTemplates);
                showSuccess('Template deleted successfully!');
            },
            onReject: () => {}
        });
    };

    const showSuccess = (message: string) => notify.success(message);
    const showError = (message: string) => notify.error(message);
    const showWarning = (message: string) => notify.warn(message);

    useEffect(() => {
        if (loadFailed) notify.error('Could not read the templates saved in this browser');
    }, [loadFailed, notify]);

    const download = () => {
        const blob = new Blob([code], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${templateName}.js`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex flex-col gap-4" data-code-editor>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Code editor</h1>
                    <p className="text-sm text-muted-foreground">Write a React component with PrimeReact and preview it. Templates are kept in this browser.</p>
                </div>
                <div className="flex gap-2">
                    <Select value={selectedCategory.value} onValueChange={(v) => setSelectedCategory(CATEGORIES.find((c) => c.value === v) ?? CATEGORIES[0])}>
                        <SelectTrigger aria-label="Category" className="w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                    {c.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => loadTemplate()} disabled={templates.length === 0} title="Load the last saved template">
                        <History />
                        Load last
                    </Button>
                </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-56 flex-1 flex-col gap-2">
                    <Label htmlFor="templateName">Template name</Label>
                    <Input id="templateName" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                </div>
                {templates.length > 0 && (
                    <Select value="" onValueChange={(v) => loadTemplate(v)}>
                        <SelectTrigger aria-label="Open a saved template" className="w-56">
                            <SelectValue placeholder="Open a saved template" />
                        </SelectTrigger>
                        <SelectContent>
                            {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {templates.length > 0 && (
                    <IconButton label="Delete the last saved template" className="text-destructive" onClick={() => deleteTemplate(templates[templates.length - 1].id)}>
                        <Trash2 />
                    </IconButton>
                )}
                <Button type="button" onClick={generatePreview}>
                    <Eye />
                    Preview
                </Button>
                <Button type="button" variant="secondary" onClick={saveTemplate}>
                    <Save />
                    Save
                </Button>
                <Button type="button" variant="outline" onClick={download}>
                    <Download />
                    Download
                </Button>
            </div>
            <div className="grid min-h-[60vh] gap-3 lg:h-[calc(100vh-16rem)] lg:grid-cols-[3fr_2fr]">
                <div className="min-h-[24rem] overflow-hidden rounded-lg border">
                    <MonacoEditor language="javascript" value={code} onChange={(value) => setCode(value ?? '')} height="100%" />
                </div>
                <div className="flex min-h-[24rem] flex-col gap-2 rounded-lg border p-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">Preview</h2>
                        {isPreviewLoading && (
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Spinner /> Generating…
                            </span>
                        )}
                    </div>
                    <div className="flex-1 rounded-md border">
                        {preview || (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                                <EyeOff className="size-8" />
                                Preview the code to see the result
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const defaultTemplate = `
import { useState } from 'react';
import { InputText } from 'primereact/inputtext';

const App = () => {
    const [value, setValue] = useState('');

    return (
        <div className="p-4">
            <InputText
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Type something..."
                className="w-full"
            />
        </div>
    );
};

export default App;
`;
