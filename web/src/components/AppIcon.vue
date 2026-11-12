<script setup lang="ts">
// Icône choisie par son nom (déclaré dans le YAML). Jeu courant immédiat, catalogue complet chargé à la demande ;
// « terminal » en attendant ou si le nom est inconnu.
import { computed } from 'vue';
import { Terminal } from 'lucide-vue-next';
import { allIcons, resolveIcon } from '@/lib/icons';

const props = defineProps<{ name?: string; size?: number }>();
// `allIcons` est lu pour que le rendu se refasse une fois le catalogue chargé.
const comp = computed(() => (allIcons.value, resolveIcon(props.name)) ?? Terminal);
</script>

<template>
  <component :is="comp" :size="size ?? 18" />
</template>
