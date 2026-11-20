"""Causal ST-GCN shared by the sequence trainer and the stepwise ONNX export."""

import torch
from torch import Tensor, nn
from torch.nn import functional as F

NODE_COUNT = 42
FEATURE_COUNT = 13
WIDTH = 32
DILATIONS = (1, 2, 4)
LABELS = ("<blank>", "Box", "Cylinder", "Union")
HAND_VALID_INDEX = 9
MODEL_FILENAME = "gesture.onnx"
INPUT_NAMES = ("frame", "state0", "state1", "state2")
OUTPUT_NAMES = ("logits", "next0", "next1", "next2")

HAND_EDGES = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20), (17, 0),
)


def skeleton_adjacency() -> Tensor:
    adjacency = torch.zeros(NODE_COUNT, NODE_COUNT)
    edges = (*HAND_EDGES, *((left + 21, right + 21) for left, right in HAND_EDGES), (0, 21))
    for left, right in edges:
        adjacency[left, right] = 1.0
        adjacency[right, left] = 1.0
    return adjacency / adjacency.sum(dim=0)


class CausalGraphBlock(nn.Module):
    def __init__(self, input_width: int, dilation: int):
        super().__init__()
        self.context = dilation * 2
        self.project_self = nn.Conv2d(input_width, WIDTH, 1)
        self.project_neighbor = nn.Conv2d(input_width, WIDTH, 1, bias=False)
        self.temporal = nn.Conv2d(WIDTH, WIDTH, (1, 3), dilation=(1, dilation))
        self.residual = nn.Conv2d(input_width, WIDTH, 1) if input_width != WIDTH else nn.Identity()

    def spatial(self, features: Tensor, adjacency: Tensor) -> Tensor:
        # Spatial aggregation across the skeleton leaves every time step in place.
        neighbors = torch.matmul(features.transpose(-1, -2), adjacency).transpose(-1, -2)
        return F.relu(self.project_self(features) + self.project_neighbor(neighbors))

    def forward(self, features: Tensor, adjacency: Tensor) -> Tensor:
        spatial = self.spatial(features, adjacency)
        temporal = self.temporal(F.pad(spatial, (self.context, 0)))
        return F.relu(temporal + self.residual(features))

    def step(self, features: Tensor, adjacency: Tensor, state: Tensor) -> tuple[Tensor, Tensor]:
        history = torch.cat((state, self.spatial(features, adjacency)), dim=-1)
        output = F.relu(self.temporal(history) + self.residual(features))
        return output, history[..., 1:]


class GestureModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer("adjacency", skeleton_adjacency())
        self.register_buffer(
            "scale", torch.tensor([1, 1, 1, 1, 1, 0.2, 0.2, 1, 10, 1, 1, 1, 1]),
        )
        self.blocks = nn.ModuleList(
            CausalGraphBlock(FEATURE_COUNT if index == 0 else WIDTH, dilation)
            for index, dilation in enumerate(DILATIONS)
        )
        self.classify = nn.Linear(WIDTH, len(LABELS))

    def prepare(self, frames: Tensor) -> Tensor:
        return (frames * self.scale).clamp(-8, 8).permute(0, 3, 2, 1)

    def classify_nodes(self, nodes: Tensor, frames: Tensor) -> Tensor:
        mask = frames[..., HAND_VALID_INDEX].transpose(-1, -2).unsqueeze(1)
        pooled = (nodes * mask).sum(dim=2) / mask.sum(dim=2).clamp(min=1)
        return self.classify(pooled.transpose(1, 2))

    def forward(self, frames: Tensor) -> Tensor:
        """Input [batch, time, nodes, features], output [batch, time, labels]."""
        nodes = self.prepare(frames)
        for block in self.blocks:
            nodes = block(nodes, self.adjacency)
        return self.classify_nodes(nodes, frames)

    def empty_state(self, batch_size: int = 1) -> tuple[Tensor, ...]:
        return tuple(
            self.adjacency.new_zeros((batch_size, WIDTH, NODE_COUNT, block.context))
            for block in self.blocks
        )

    def step(self, frame: Tensor, states: tuple[Tensor, ...]) -> tuple[Tensor, ...]:
        """Input one [batch, nodes, features] frame and three explicit caches."""
        frames = frame.unsqueeze(1)
        nodes = self.prepare(frames)
        next_states = []
        for block, state in zip(self.blocks, states, strict=True):
            nodes, next_state = block.step(nodes, self.adjacency, state)
            next_states.append(next_state)
        return self.classify_nodes(nodes, frames).squeeze(1), *next_states


class ExportStep(nn.Module):
    def __init__(self, model: GestureModel):
        super().__init__()
        self.model = model

    def forward(self, frame: Tensor, state0: Tensor, state1: Tensor, state2: Tensor) -> tuple[Tensor, ...]:
        return self.model.step(frame, (state0, state1, state2))
