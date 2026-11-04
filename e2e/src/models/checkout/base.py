from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CheckoutModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        hide_input_in_errors=True,
    )
