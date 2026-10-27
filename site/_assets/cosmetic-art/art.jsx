// What the landing page draws, by marker key. Every entry is the app's own renderer at its still
// frame (motion="off" / reduced motion), so the site shows exactly what players see in-app.
import { renderToStaticMarkup } from 'react-dom/server';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { HaloRing, haloStyleForItem } from '@/components/economy/halo-art';
import { ItemArt } from '@/components/economy/item-art';
import { PatronCrest } from '@/components/story-sticker/patron-crest';
import { FlameLogo } from '@/components/ui/flame-logo';
import { getItem } from '@/lib/economy/catalog';

const art = {};

// Shop grid, profile loadout shelf, and the Flame Pass reward track.
for (const id of [
  'flare-void-plasma', 'flame-meme-locked-in', 'halo-hades', 'halo-sakura', 'card-marble-of-olympus',
  'flame-electric-cyan', 'flame-lime-volt', 'card-forged-bronze',
  'flame-forge', 'medal-campus-sovereign', 'relic-icarus-feather',
  'card-emberfall', 'particle-void-smoke', 'halo-emberfall', 'halo-emberfall-mythic', 'card-emberfall-mythic', 'medal-emberfall-crown',
]) {
  const item = getItem(id);
  if (!item) throw new Error(`not in the catalog at HEAD: ${id}`);
  art[id] = () => <ItemArt item={item} size={48} motion="off" />;
}
for (const box of ['furnace', 'hestia', 'hephaestus']) art[`box-${box}`] = () => <BoxArt boxKey={box} size={48} motion="off" />;

art.ember = () => <EmberIcon size={16} />;
art.flame = () => <FlameLogo size={48} />;
art['crest-heracles'] = () => <PatronCrest patronKey="heracles" name="Heracles" size={16} />;

// The profile card's equipped halo, drawn round an avatar of radius 31.7 in the 0-100 box.
const hades = getItem('halo-hades');
art['halo-ring-hades'] = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <HaloRing style={haloStyleForItem(hades)} from={hades.art.from} to={hades.art.to} boost={0} spread={0} rAvatar={31.7} uid="pc" />
  </svg>
);

const out = {};
for (const [key, el] of Object.entries(art)) out[key] = renderToStaticMarkup(el());
process.stdout.write(JSON.stringify(out));
