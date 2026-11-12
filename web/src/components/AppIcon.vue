<script setup lang="ts">
// Icône choisie par son nom (déclaré dans le YAML) parmi un jeu restreint de lucide ; repli sur « terminal ».
import { computed } from 'vue';
import {
  Terminal, Play, Database, HardDrive, Cloud, CloudSun, Mail, Server, Shield, Rocket, Wrench, Bell, Camera, Download, Upload,
  RefreshCw, Trash2, Archive, Home, Zap, FileText, Globe, Cpu, Bot, AlertTriangle, Calendar, Clock, Folder, Image, Music, Video,
  Wifi, Lock, Key, Package, Printer, Thermometer, Lightbulb, Tv, Smartphone, Film, BookOpen, Coffee, Heart, Star, Sun, Moon, Leaf,
} from 'lucide-vue-next';

const ICONS: Record<string, unknown> = {
  terminal: Terminal, play: Play, database: Database, 'hard-drive': HardDrive, cloud: Cloud, 'cloud-sun': CloudSun, mail: Mail,
  server: Server, shield: Shield, rocket: Rocket, wrench: Wrench, bell: Bell, camera: Camera, download: Download, upload: Upload,
  'refresh-cw': RefreshCw, 'trash-2': Trash2, archive: Archive, home: Home, zap: Zap, 'file-text': FileText, globe: Globe, cpu: Cpu,
  bot: Bot, 'alert-triangle': AlertTriangle, calendar: Calendar, clock: Clock, folder: Folder, image: Image, music: Music, video: Video,
  wifi: Wifi, lock: Lock, key: Key, package: Package, printer: Printer, thermometer: Thermometer, lightbulb: Lightbulb, tv: Tv,
  smartphone: Smartphone, film: Film, 'book-open': BookOpen, coffee: Coffee, heart: Heart, star: Star, sun: Sun, moon: Moon, leaf: Leaf,
};


const props = defineProps<{ name?: string; size?: number }>();
const comp = computed(() => ICONS[props.name || 'terminal'] ?? Terminal);
</script>

<template>
  <component :is="comp" :size="size ?? 18" />
</template>
