import { useDocumentTitle } from '../lib/useDocumentTitle';

// Página provisória: as tarefas T14 a T19 preenchem cada rota.
export function Placeholder({
  title,
  task,
  children,
}: {
  title: string;
  task: string;
  children?: React.ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div className="container page">
      <h1 className="page-title">{title}</h1>
      <p className="page-note">Esta página será construída na tarefa {task}.</p>
      {children}
    </div>
  );
}
