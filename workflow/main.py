"""Run from the repository root with python -m workflow.main."""
from render import FlowContext, Workflows

from workflow.inspection import inspect_upload, speak_caption

app = Workflows()


@app.flow(name="inspect_part", timeout_seconds=60)
def inspect_part(ctx: FlowContext, upload: dict) -> dict:
    report = ctx.step("inspect-exported-mesh", inspect_upload, upload)
    audio = ctx.step("speak-measurements", speak_caption, report["caption"])
    return {**report, **audio}


if __name__ == "__main__":
    app.start()
