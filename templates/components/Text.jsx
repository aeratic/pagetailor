export default function Text({ props }) {
  return <p style={{ margin: 0, color: props.muted ? "var(--pt-color-muted)" : "inherit" }}>{props.content}</p>;
}
