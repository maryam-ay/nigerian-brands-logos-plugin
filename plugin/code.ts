/// <reference types="@figma/plugin-typings" />

declare function btoa(data: string): string;
declare function atob(data: string): string;

import type { LogoEntry, LogosManifest } from "./types";

figma.showUI(__html__, { width: 400, height: 600, title: "Nigerian Brands Logos" });

function sanitizeSvg(svgString: string): string {
  let s = svgString.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/\s+on\w+="[^"]*"/gi, "");
  s = s.replace(/\s+on\w+='[^']*'/gi, "");
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  s = s.replace(/\s+href="https?:\/\/[^"]*"/gi, "");
  s = s.replace(/\s+src="https?:\/\/[^"]*"/gi, "");
  if (!s.includes("xmlns=")) {
    s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return s;
}

async function githubGetSha(
  token: string, owner: string, repo: string, path: string
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

async function githubPut(
  token: string, owner: string, repo: string,
  path: string, content: string, message: string, sha?: string | null
): Promise<boolean> {
  const body: Record<string, string> = { message, content: btoa(unescape(encodeURIComponent(content))) };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(body),
    }
  );
  return res.ok;
}

async function githubDelete(
  token: string, owner: string, repo: string, path: string, message: string
): Promise<boolean> {
  const sha = await githubGetSha(token, owner, repo, path);
  if (!sha) return false;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ message, sha }),
    }
  );
  return res.ok;
}

async function updateManifest(
  token: string, owner: string, repo: string,
  logoData: LogoEntry, action: "add" | "update" | "delete"
): Promise<boolean> {
  const manifestPath = "public/logos.json";
  const manifestRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${manifestPath}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!manifestRes.ok) return false;

  const manifestFile = (await manifestRes.json()) as { sha: string; content: string };
  const manifest: LogosManifest = JSON.parse(
    decodeURIComponent(escape(atob(manifestFile.content.replace(/\n/g, ""))))
  );

  if (action === "add") {
    manifest.logos.push(logoData);
  } else if (action === "update") {
    const idx = manifest.logos.findIndex((l) => l.id === logoData.id);
    if (idx !== -1) manifest.logos[idx] = logoData;
  } else {
    manifest.logos = manifest.logos.filter((l) => l.id !== logoData.id);
  }

  manifest.totalLogos = manifest.logos.length;
  manifest.lastUpdated = new Date().toISOString();

  return githubPut(
    token, owner, repo, manifestPath,
    JSON.stringify(manifest, null, 2),
    `chore: update logos manifest (${action} ${logoData.name})`,
    manifestFile.sha
  );
}

async function githubUpdate(
  action: "add" | "update" | "delete",
  logoData: LogoEntry,
  assetContent?: string
): Promise<{ success: boolean; message: string }> {
  const token = (await figma.clientStorage.getAsync("github-token")) as string;
  const owner = (await figma.clientStorage.getAsync("github-owner")) as string;
  const repo = (await figma.clientStorage.getAsync("github-repo")) as string;

  if (!token || !owner || !repo) {
    return { success: false, message: "GitHub not configured. Please set up in admin settings." };
  }

  try {
    if (action === "delete") {
      const ext = logoData.quality === "svg" ? "svg" : "png";
      await githubDelete(token, owner, repo, `public/assets/logos/${logoData.id}.${ext}`, `chore: remove ${logoData.name} logo`);
    } else if (assetContent) {
      const ext = logoData.quality === "svg" ? "svg" : "png";
      const filePath = `public/assets/logos/${logoData.id}.${ext}`;
      const sha = await githubGetSha(token, owner, repo, filePath);
      const ok = await githubPut(token, owner, repo, filePath, assetContent, `${action === "add" ? "feat" : "fix"}: ${action} ${logoData.name} logo`, sha);
      if (!ok) return { success: false, message: "Failed to upload asset to GitHub." };
    }

    const manifestOk = await updateManifest(token, owner, repo, logoData, action);
    if (!manifestOk) return { success: false, message: "Asset saved but manifest update failed." };

    return { success: true, message: `Logo ${action}d successfully.` };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

figma.ui.onmessage = async (msg: Record<string, unknown>) => {
  switch (msg.type) {
    case "insert-svg": {
      try {
        const clean = sanitizeSvg(msg.svgString as string);
        const node = figma.createNodeFromSvg(clean);
        node.name = msg.logoName as string;
        figma.currentPage.appendChild(node);
        figma.viewport.scrollAndZoomIntoView([node]);
        figma.currentPage.selection = [node];
        figma.ui.postMessage({ type: "insert-success", name: msg.logoName });
      } catch {
        figma.notify("Couldn't insert logo. Try again.", { error: true });
      }
      break;
    }

    case "insert-png": {
      try {
        const image = figma.createImage(new Uint8Array(msg.pngBytes as number[]));
        const rect = figma.createRectangle();
        rect.resize((msg.width as number) || 200, (msg.height as number) || 200);
        rect.name = msg.logoName as string;
        rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FIT" }];
        figma.currentPage.appendChild(rect);
        figma.viewport.scrollAndZoomIntoView([rect]);
        figma.currentPage.selection = [rect];
        figma.ui.postMessage({ type: "insert-success", name: msg.logoName });
      } catch {
        figma.notify("Couldn't insert logo. Try again.", { error: true });
      }
      break;
    }

    case "notify":
      figma.notify(msg.message as string, (msg.options as NotificationOptions | undefined) ?? {});
      break;

    case "close":
      figma.closePlugin();
      break;

    case "resize":
      figma.ui.resize(msg.width as number, msg.height as number);
      break;

    case "cache-get": {
      const value = await figma.clientStorage.getAsync(msg.key as string);
      figma.ui.postMessage({ type: "cache-result", key: msg.key, value, _id: msg._id });
      break;
    }

    case "cache-set":
      await figma.clientStorage.setAsync(msg.key as string, msg.value);
      break;

    case "admin-get-config": {
      const token = await figma.clientStorage.getAsync("github-token");
      const owner = await figma.clientStorage.getAsync("github-owner");
      const repo = await figma.clientStorage.getAsync("github-repo");
      const pwHash = await figma.clientStorage.getAsync("admin-pw-hash");
      figma.ui.postMessage({
        type: "admin-config",
        hasConfig: !!(token && owner && repo),
        hasPassword: !!pwHash,
        owner,
        repo,
        _id: msg._id,
      });
      break;
    }

    case "admin-save-config":
      await figma.clientStorage.setAsync("github-token", msg.token);
      await figma.clientStorage.setAsync("github-owner", msg.owner);
      await figma.clientStorage.setAsync("github-repo", msg.repo);
      figma.ui.postMessage({ type: "admin-config-saved", _id: msg._id });
      break;

    case "admin-get-pw-hash": {
      const hash = await figma.clientStorage.getAsync("admin-pw-hash");
      figma.ui.postMessage({ type: "admin-pw-hash-result", hash, _id: msg._id });
      break;
    }

    case "admin-set-pw-hash":
      await figma.clientStorage.setAsync("admin-pw-hash", msg.hash);
      figma.ui.postMessage({ type: "admin-pw-hash-set", _id: msg._id });
      break;

    case "admin-add-logo": {
      const result = await githubUpdate("add", msg.logoData as LogoEntry, msg.assetContent as string | undefined);
      figma.ui.postMessage({ type: "admin-update-result", ...result, _id: msg._id });
      break;
    }

    case "admin-update-logo": {
      const result = await githubUpdate("update", msg.logoData as LogoEntry, msg.assetContent as string | undefined);
      figma.ui.postMessage({ type: "admin-update-result", ...result, _id: msg._id });
      break;
    }

    case "admin-delete-logo": {
      const result = await githubUpdate("delete", msg.logoData as LogoEntry);
      figma.ui.postMessage({ type: "admin-update-result", ...result, _id: msg._id });
      break;
    }
  }
};

export {};
