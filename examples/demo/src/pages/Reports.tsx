import { useParams } from 'react-router';
import { MARKER } from '../marker';

/** Lazy-loaded route. */
export default function Reports() {
  const { id } = useParams();
  return (
    <>
      <h1>{id ? `Report ${id}` : 'Reports'}</h1>
      <p data-testid="reports-secret">Quarterly numbers: {MARKER} (lazy chunk)</p>
    </>
  );
}
