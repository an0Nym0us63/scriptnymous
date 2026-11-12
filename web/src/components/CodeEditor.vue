<script setup lang="ts">
// Éditeur CodeMirror 6 : coloration selon le langage (bash, python, javascript, yaml), thème sombre.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const props = defineProps<{ modelValue: string; lang: 'bash' | 'python' | 'javascript' | 'yaml' | 'json' | 'text'; minHeight?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
const langConf = new Compartment();

function langExt() {
  switch (props.lang) {
    case 'bash':
      return StreamLanguage.define(shell);
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'yaml':
      return yaml();
    case 'json':
      return json();
    default:
      return [];
  }
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        oneDark,
        langConf.of(langExt()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
        }),
        EditorView.theme({ '&': { minHeight: props.minHeight ?? '320px' }, '.cm-scroller': { minHeight: props.minHeight ?? '320px' } }),
      ],
    }),
  });
});
watch(
  () => props.modelValue,
  (v) => {
    if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
  },
);
watch(
  () => props.lang,
  () => view?.dispatch({ effects: langConf.reconfigure(langExt()) }),
);
onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div ref="host" class="w-full" />
</template>
