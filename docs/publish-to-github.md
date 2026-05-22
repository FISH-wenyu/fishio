# Publishing Fishio to GitHub

A complete checklist of how a working programmer ships a project — from `git init` to a polished public repo that others can fork and use.

## 0. One-time prerequisites

- Install **Git** ([git-scm.com](https://git-scm.com/download/win)). Verify: `git --version`
- Install the **GitHub CLI** (optional but recommended). Windows: `winget install --id GitHub.cli`. Verify: `gh --version`
- Have a **GitHub account** ([github.com](https://github.com))
- Configure your identity once:
  ```bash
  git config --global user.name  "Your Name"
  git config --global user.email "you@example.com"
  ```
- Authenticate the CLI once: `gh auth login` → pick GitHub.com → HTTPS → Login with browser

## 1. Sanity check the working tree

Before initialising the repo, make sure no secrets escape:

```bash
cd C:\Users\19547\Projects\Fishio
type .gitignore      # confirm .env, state/, cache/ are listed
type .env.example    # confirm this is the template (no real secrets)
```

Double-check that `.env` is in `.gitignore`. If not, **stop and add it** — `.env` contains your API keys and you don't want it on the internet.

## 2. Initialize the repo

```bash
git init
git add -A
git status           # eyeball: should NOT contain .env, state/state.json, cache/, node_modules/
git commit -m "Initial commit: Fishio v0.1"
```

If `git status` shows secrets being staged, **don't commit yet** — fix `.gitignore`, then:

```bash
git rm --cached .env state/state.json   # un-stage them
git add -A
git status                              # confirm they're gone
git commit -m "Initial commit: Fishio v0.1"
```

## 3. Create the GitHub repo

**Option A — `gh` CLI (one command, recommended):**
```bash
gh repo create fishio --public --source=. --remote=origin --description="Personal AI radio — Claude as brain, NetEase Music, ElevenLabs voice."
```

**Option B — Web UI:**
1. Open https://github.com/new
2. Repository name: `fishio`
3. Description: same as above
4. Public / Private — public if you want to share
5. **Don't** add a README, .gitignore, or LICENSE (you already have them)
6. Create repository
7. Copy the HTTPS URL shown on the next page
8. Wire it up:
   ```bash
   git remote add origin https://github.com/<your-username>/fishio.git
   ```

## 4. Push

```bash
git branch -M main
git push -u origin main
```

`-u origin main` sets the upstream so future pushes are just `git push`.

## 5. Polish the repo page (optional but professional)

On GitHub, click **About** (right sidebar gear icon) and add:
- **Website**: your stable URL (`https://shaking-kissable-breeches.ngrok-free.dev` or your domain)
- **Topics**: `claude` `ai-radio` `music-player` `node` `pwa` — these help discoverability
- ☑ Check **Releases** and **Packages** if relevant

## 6. Tag a release

For a sharable v1.0:

```bash
git tag -a v0.1.0 -m "Fishio v0.1.0 — initial public release"
git push origin v0.1.0
```

Then on the repo page → **Releases** → **Draft a new release** → pick the tag → write release notes (what's in v0.1) → **Publish release**.

Or via CLI:
```bash
gh release create v0.1.0 --title "v0.1.0 — first release" --notes "Initial public release. See README for setup."
```

## 7. Ongoing workflow (after the initial push)

```bash
# day-to-day
git status                  # what changed?
git diff                    # eyeball what's about to be committed
git add <files>             # stage what you want
git commit -m "short verb-leading message"
git push

# pull updates from anywhere else you've pushed from
git pull --rebase

# feature work on a branch
git switch -c feature/lyric-overlay
# ... commit a few times ...
git push -u origin feature/lyric-overlay
gh pr create --fill         # opens a PR
# review on GitHub → merge → delete branch
git switch main
git pull --rebase
git branch -d feature/lyric-overlay
```

## 8. If you accidentally commit a secret

This happens to everyone once. Do this immediately:

1. **Revoke / rotate the leaked key** at the source (ElevenLabs / OpenWeather / etc.) — the secret is on the internet now, treat it as burned.
2. **Strip it from history** with [git-filter-repo](https://github.com/newren/git-filter-repo) (recommended) or BFG. `git filter-repo --invert-paths --path .env` (works on a single file).
3. **Force-push**: `git push --force-with-lease origin main`. Other contributors will need to re-clone.
4. Update `.gitignore` and verify `.env` won't recur.

## 9. README and discoverability

The README that ships with Fishio is already shaped for a public repo:
- Lead paragraph explains the idea
- Requirements + 5-line Quick Start
- Architecture diagram (ASCII)
- File layout
- Smoke tests
- License

If you change behaviour, **update README first**. Stale READMEs are the #1 reason new contributors bounce.

## 10. Inviting collaborators

```bash
gh repo edit --visibility=public           # if you started private
gh repo invite <github-username>           # add a contributor
```

Or via the web UI: repo → **Settings** → **Collaborators**.

## 11. Issues, PRs, and project hygiene

- Use **Issues** for everything not currently being coded — bugs, ideas, "would be nice". Close them with `git commit -m "...; fixes #12"`.
- Use **Pull Requests** for every non-trivial change, even on your own repo. Reviewing your own diff catches bugs.
- Keep `main` deployable. Anything risky goes on a feature branch first.

## 12. Suggested next-steps (when you want to take this further)

- Add a `CONTRIBUTING.md` describing how to set up dev environment
- Add an `ISSUE_TEMPLATE/` folder
- Add a `.github/workflows/ci.yml` to run smoke scripts on every push (eslint, smoke tests)
- Publish to a package registry if Fishio modules become reusable
- Set up GitHub Pages for the README / static docs

---

That's the standard flow most working programmers follow on every new project. Skip the polish steps if you just want to share quickly; ship them when the project matures.
