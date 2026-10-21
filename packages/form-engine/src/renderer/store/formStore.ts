// stores/formStore.ts
import { create } from 'zustand';
import type { FormField, FormTemplate, TemplateRuntimeConfig } from '@itrms/schemas';
import { EMPTY_RUNTIME } from '@itrms/schemas';

type FormState = {
    fields: FormField[];
    template: FormTemplate;
    /** Data sources / variables / submit config persisted in `form_config.runtime`. */
    runtime: TemplateRuntimeConfig;
    actions: {
        setRuntime: (runtime: TemplateRuntimeConfig) => void;
        // COMPLETE REPLACEMENT ONLY
        setFields: (fields: FormField[]) => void;
        setTemplate: (template: FormTemplate) => void;

        // FIELD OPERATIONS (ALL RETURN NEW ARRAYS)
        addField: (field: FormField) => void;
        updateField: (id: string, field: FormField) => void;
        removeField: (id: string) => void;
        clearFields: () => void;

        addTemplate: (Template: FormTemplate) => void;
        updateTemplate: (id: string, Template: FormTemplate) => void;
        removeTemplate: (id: string) => void;
        clearTemplates: () => void;
    };
};

const useFormStore = create<FormState>()((set) => ({
    fields: [],
    template: {
        name: '',
        slug: '',
        form_config: {}
    },

    runtime: EMPTY_RUNTIME,

    actions: {
        setRuntime: (runtime) => set({ runtime }),

        // 1. Complete replacement
        setFields: (newFields) => set({ fields: newFields }),

        // 2. Add field (new array)
        addField: (field) =>
            set((state) => ({
                fields: [...state.fields, field] // or state.fields.concat(field)
            })),

        // 3. Update field (new array)
        updateField: (id, updatedField) =>
            set((state) => ({
                fields: state.fields.map((f) => (f.id === id ? updatedField : f))
            })),

        // 4. Remove field (new array)
        removeField: (id) =>
            set((state) => ({
                fields: state.fields.filter((f) => f.id !== id)
            })),

        // 5. Clear all (empty array)
        clearFields: () => set({ fields: [], runtime: EMPTY_RUNTIME }),

        // 1. Complete replacement
        setTemplate: (newTemplate) => set({ template: newTemplate }),

        // 2. Add field (new array)
        addTemplate: (template) =>
            set((state) => ({
                template: { ...state.template, template }
            })),

        // 3. Update template (replace if id matches)
        updateTemplate: (id, updatedTemplate) =>
            set((state) => ({
                template: state.template && state.template.id === id ? updatedTemplate : state.template
            })),

        // 4. Remove template (reset to empty template)
        removeTemplate: () =>
            set(() => ({
                template: {
                    name: '',
                    slug: '',
                    form_config: {}
                }
            })),

        // 5. Clear all (reset to empty template)
        clearTemplates: () => set({ template: { name: '', slug: '', form_config: {} } })
    }
}));

// STRICT SELECTORS
export const useFields = () => useFormStore((state) => state.fields);
export const useTemplate = () => useFormStore((state) => state.template);
export const useRuntimeConfig = () => useFormStore((state) => state.runtime);
export const useFormActions = () => useFormStore((state) => state.actions);
