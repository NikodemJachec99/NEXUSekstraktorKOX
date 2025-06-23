const TextareaPlugin = function() {
  return {
    components: {
      Input: (Original, system) => (props) => {
        const { schema, value, onChange } = props;
        if (schema?.type === "string" && schema?.format === "textarea") {
          return (
            <textarea
              rows="10"
              cols="60"
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              style={{ fontFamily: "monospace", width: "100%" }}
            />
          );
        }

        return Original(props);
      },
    },
  };
};
