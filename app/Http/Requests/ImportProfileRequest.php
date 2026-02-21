<?php

namespace App\Http\Requests;

use App\Models\ImportProfile;
use Illuminate\Validation\Rule;

class ImportProfileRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     */
    public function rules(): array
    {
        /** @var ImportProfile|null $importProfile */
        $importProfile = $this->route('importProfile');

        return [
            'name' => [
                'required',
                'min:' . self::DEFAULT_STRING_MIN_LENGTH,
                'max:' . self::DEFAULT_STRING_MAX_LENGTH,
                Rule::unique('import_profiles')->where(fn ($query) => $query
                    ->where('user_id', $this->user()->id)
                    ->when(
                        $importProfile,
                        fn ($query) => $query->where('id', '!=', $importProfile->id)
                    )),
            ],
            'source_name_pattern' => [
                'nullable',
                'string',
                'max:191',
            ],
            'is_default' => [
                'sometimes',
                'boolean',
            ],
            'csv_options' => [
                'nullable',
                'array',
            ],
            'column_mapping' => [
                'nullable',
                'array',
            ],
            'value_mappings' => [
                'nullable',
                'array',
            ],
            'rules' => [
                'nullable',
                'array',
            ],
        ];
    }
}
