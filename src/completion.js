// Shell completion scripts, built from the command's own options so they never go stale.
// `options` are Commander Option objects: { short, long, description, required, optional, argChoices }.

const SHELLS = ['zsh', 'bash'];

// Options that take a folder or a file get those completed; others take free text.
const VALUE_KINDS = { '--dir': 'directory', '--parent': 'directory', '--config': 'file' };

const takesValue = (option) => option.required || option.optional;
const flagsOf = (option) => [option.short, option.long].filter(Boolean);

function zshSpec(option) {
  const flags = flagsOf(option);
  const description = option.description.replace(/[[\]:]/g, '').replace(/'/g, '\'\\\'\'');
  const names = flags.length > 1 ? `'(${flags.join(' ')})'{${flags.join(',')}}` : `'${flags[0]}`;
  let value = '';
  if (option.argChoices) value = `:value:(${option.argChoices.join(' ')})`;
  else if (VALUE_KINDS[option.long] === 'directory') value = ':folder:_files -/';
  else if (VALUE_KINDS[option.long] === 'file') value = ':file:_files';
  else if (takesValue(option)) value = ':value: ';
  return flags.length > 1 ? `${names}'[${description}]${value}'` : `${names}[${description}]${value}'`;
}

function zshScript(options) {
  const specs = options.map((option) => `    ${zshSpec(option)} \\`).join('\n');
  return `#compdef org
# Completion for org (smart-organizer). Save as _org in a folder on $fpath, e.g.:
#   org --completion zsh > ~/.zfunc/_org   (and add: fpath=(~/.zfunc $fpath); autoload -U compinit; compinit)
_arguments -s \\
${specs}
    '*:file:_files'
`;
}

function bashScript(options) {
  const all = options.flatMap(flagsOf).join(' ');
  const cases = [];
  for (const option of options) {
    const flags = flagsOf(option).join('|');
    if (option.argChoices) cases.push(`    ${flags}) COMPREPLY=($(compgen -W "${option.argChoices.join(' ')}" -- "$cur")); return ;;`);
    else if (VALUE_KINDS[option.long] === 'directory') cases.push(`    ${flags}) COMPREPLY=($(compgen -d -- "$cur")); return ;;`);
    else if (VALUE_KINDS[option.long] === 'file') cases.push(`    ${flags}) COMPREPLY=($(compgen -f -- "$cur")); return ;;`);
    else if (takesValue(option)) cases.push(`    ${flags}) return ;;`);
  }
  return `# Completion for org (smart-organizer). Load it from ~/.bashrc, e.g.:
#   org --completion bash > ~/.org-completion.bash   (and add: source ~/.org-completion.bash)
_org() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
${cases.join('\n')}
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${all}" -- "$cur"))
  else
    COMPREPLY=($(compgen -f -- "$cur"))
  fi
}
complete -o filenames -F _org org
`;
}

function completionScript(shell, options) {
  return shell === 'zsh' ? zshScript(options) : bashScript(options);
}

module.exports = { SHELLS, completionScript };
