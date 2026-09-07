<script lang="ts">
  import {
    cuteProgramIconMark,
    programIconPath,
    type ProgramIconName,
  } from "./program-icons";

  let {
    name = "orbital_strength",
    label,
  }: { name?: ProgramIconName; label?: string } = $props();

  const source = $derived(programIconPath(name));
  const cuteMark = $derived(cuteProgramIconMark(name));
</script>

<span
  class="program-icon-shell"
  class:achievement={name === "lunar_completion"}
>
  <img
    class="program-icon orbital-program-icon"
    src={source}
    alt={label ?? ""}
    aria-hidden={label ? undefined : "true"}
    draggable="false"
  />
  <span class="cute-program-icon" data-cute-icon={cuteMark} aria-hidden="true">
    {#if name === "orbital_strength"}
      <svg class="cute-icon-art silhouette-icon" viewBox="0 0 64 64">
        <path
          d="M32 56C25 49 9 39 9 24 9 13 21 8 29 17l3 4 3-4c8-9 20-4 20 7 0 15-16 25-23 32Z"
        />
      </svg>
    {:else if name === "launch_vector"}
      <svg class="cute-icon-art" viewBox="0 0 64 64">
        <path
          d="M16 26 14 10l14 9h8l14-9-2 16c5 4 7 9 7 15 0 10-10 17-23 17S9 51 9 41c0-6 2-11 7-15Z"
        />
        <circle cx="24" cy="37" r="2.5" />
        <circle cx="40" cy="37" r="2.5" />
        <path d="m28 45 4 3 4-3M18 44 6 41m12 8L6 52m40-8 12-3m-12 8 12 3" />
      </svg>
    {:else if name === "orbital_relay"}
      <svg class="cute-icon-art original-flower-art" viewBox="0 0 64 64">
        <circle cx="32" cy="15" r="11" />
        <circle cx="47" cy="23" r="11" />
        <circle cx="47" cy="41" r="11" />
        <circle cx="32" cy="49" r="11" />
        <circle cx="17" cy="41" r="11" />
        <circle cx="17" cy="23" r="11" />
        <circle cx="32" cy="32" r="9" />
      </svg>
    {:else if name === "solar_forge"}
      <svg class="cute-icon-art flower-art" viewBox="0 0 64 64">
        <circle cx="32" cy="17" r="11" />
        <circle cx="47" cy="29" r="11" />
        <circle cx="41" cy="47" r="11" />
        <circle cx="23" cy="47" r="11" />
        <circle cx="17" cy="29" r="11" />
        <circle cx="32" cy="33" r="8" />
      </svg>
    {:else if name === "atlas_lifter"}
      <svg class="cute-icon-art dog-art" viewBox="0 0 64 64">
        <path class="silhouette" d="M19 27C9 12 3 16 7 31c2 7 6 10 13 10Z" />
        <path class="silhouette" d="M45 27c10-15 16-11 12 4-2 7-6 10-13 10Z" />
        <ellipse class="silhouette" cx="32" cy="36" rx="17" ry="21" />
        <circle class="cutout" cx="25" cy="34" r="2.4" />
        <circle class="cutout" cx="39" cy="34" r="2.4" />
        <ellipse class="cutout muzzle" cx="32" cy="45" rx="8" ry="6" />
        <path class="face-line" d="m28 44 4 3 4-3m-4 3v4" />
      </svg>
    {:else if name === "mission_control"}
      <svg class="cute-icon-art sitting-cat-art" viewBox="0 0 64 64">
        <ellipse class="silhouette" cx="30" cy="42" rx="14" ry="17" />
        <circle class="silhouette" cx="27" cy="23" r="12" />
        <path class="silhouette" d="m17 17 2-12 9 8m9 4L35 5l-9 8" />
        <path
          class="silhouette-stroke"
          d="M41 47c14 3 16-12 8-16-6-3-10 3-6 7"
        />
        <circle class="cutout" cx="23" cy="22" r="1.8" />
        <circle class="cutout" cx="31" cy="22" r="1.8" />
      </svg>
    {:else if name === "deep_space_pathfinder"}
      <svg class="cute-icon-art barbell-art" viewBox="0 0 64 64">
        <rect x="4" y="29" width="56" height="6" rx="2" />
        <rect x="7" y="21" width="6" height="22" rx="1" />
        <rect x="14" y="17" width="8" height="30" rx="1.5" />
        <rect x="42" y="17" width="8" height="30" rx="1.5" />
        <rect x="51" y="21" width="6" height="22" rx="1" />
      </svg>
    {:else}
      <span class="cute-glyph">{cuteMark}</span>
    {/if}
  </span>
</span>

<style>
  .program-icon-shell {
    border-radius: inherit;
    container-type: inline-size;
    display: block;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    width: 100%;
  }
  .program-icon {
    display: block;
    filter: drop-shadow(0 0 7px rgb(78 219 255 / 24%));
    height: 100%;
    object-fit: contain;
    width: 100%;
  }
  .program-icon-shell.achievement .orbital-program-icon {
    border: 2px solid #d8a62c;
    border-radius: 0.28rem;
    box-sizing: border-box;
    filter: drop-shadow(0 0 7px rgb(255 200 87 / 28%));
    padding: 0.08rem;
  }
  .cute-program-icon {
    display: none;
  }
  :global(html[data-theme="cute"]) .orbital-program-icon {
    display: none;
  }
  :global(html[data-theme="cute"]) .cute-program-icon {
    align-items: center;
    background: #ffe2ed;
    border: 2px solid #5a1a36;
    border-radius: inherit;
    box-sizing: border-box;
    box-shadow: none;
    color: #a20e52;
    display: flex;
    font-family: "Nunito Sans", ui-rounded, "Arial Rounded MT Bold", sans-serif;
    font-size: clamp(1.15rem, 5cqi, 2.3rem);
    height: 100%;
    justify-content: center;
    line-height: 1;
    width: 100%;
  }
  .cute-glyph {
    display: block;
    line-height: 1;
  }
  .cute-icon-art {
    fill: none;
    height: 76%;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 4;
    width: 76%;
  }
  .cute-icon-art circle {
    fill: currentColor;
    stroke: none;
  }
  .flower-art circle:not(:last-child) {
    fill: rgb(255 255 255 / 38%);
    stroke: currentColor;
    stroke-width: 3;
  }
  .original-flower-art circle:not(:last-child) {
    fill: rgb(255 255 255 / 34%);
    stroke: currentColor;
    stroke-width: 3;
  }
  .silhouette-icon,
  .barbell-art {
    fill: currentColor;
    stroke: none;
  }
  .silhouette {
    fill: currentColor;
    stroke: none;
  }
  .cutout {
    fill: #ffe2ed !important;
    stroke: none;
  }
  .face-line {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 2.5;
  }
  .silhouette-stroke {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 7;
  }
  .barbell-art rect {
    fill: currentColor;
    stroke: none;
  }
  :global(html[data-theme="cute"])
    .program-icon-shell.achievement
    .cute-program-icon {
    background: #fff3d1;
    border-color: #946000;
    box-shadow: none;
    color: #6b4803;
  }
</style>
