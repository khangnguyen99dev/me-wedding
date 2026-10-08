import { defineStore } from 'pinia';
import { ref } from 'vue';
import { assetUrl, supabase } from '@/admin/lib/supabase';
import type { Template } from '@/admin/lib/types';

function toTemplate(row: any): Template {
    const manifest = row.manifest ?? {};
    return {
        key: row.key,
        name: row.name,
        version: row.version,
        description: row.description,
        thumbnail: row.thumbnail ? assetUrl(row.thumbnail) : null,
        status: row.status,
        sections: manifest.sections ?? {},
        theme: manifest.theme ?? {},
        theme_schema: manifest.theme_schema ?? {},
    };
}

export const useTemplatesStore = defineStore('templates', () => {
    const list = ref<Template[]>([]);
    const loading = ref(false);

    async function fetchAll(): Promise<void> {
        loading.value = true;
        try {
            const { data, error } = await supabase
                .from('templates')
                .select('key, name, version, description, thumbnail, status')
                .eq('status', 'active')
                .order('name');
            if (error) throw error;
            list.value = (data ?? []).map(toTemplate);
        } finally {
            loading.value = false;
        }
    }

    async function fetchOne(key: string): Promise<Template> {
        const { data, error } = await supabase
            .from('templates')
            .select('key, name, version, description, thumbnail, status, manifest')
            .eq('key', key)
            .single();
        if (error) throw error;
        return toTemplate(data);
    }

    return { list, loading, fetchAll, fetchOne };
});
